/* ============================================================
   engine/lib/owner.js — Owner-editor request handlers (v4, Task 2)

   The deterministic core of the click-to-edit owner UI. Every handler
   the HTTP server (engine/serve.js) exposes lives here as a plain
   function over a session object, so the proof suite can exercise the
   full edit → keep → publish cycle DIRECTLY, with no socket
   (proof 8).

   THE SESSION MODEL (Keep is separate from Publish)
   Live content is clients/<client>/. The session works on a full copy,
   clients/<client>__candidate/ (gitignored), built ANNOTATED to
   dist/<client>__candidate__annotated/ — that build is the preview the
   owner sees. Exactly one PENDING change exists at a time (unchanged);
   KEPT changes accumulate on the session's STAGED list until one
   Publish ships them all:

     edit / scaffold → constructed deterministically (the UI never
             invents values for paths; image paths are assigned here)
           → applied to the CANDIDATE (all guards run); a failing
             build rolls the candidate back — a bad change can never
             stick
           → the PENDING change: old → new, both read by resolving the
             patch address against the candidate content (never from
             any other description of the change)
     keep  → the pending change joins the STAGED list — it is already
             applied to the candidate, so its card travels with it —
             and the next edit can begin
     discard → the pending change is dropped; the candidate is rebuilt
             from live plus a REPLAY of the staged list (deterministic,
             already-validated patches and scaffolds — never an
             attempt to invert a patch), so staged changes are never
             disturbed
     discard-all → candidate reset from live, session emptied
     publish → the whole staged session in one step: candidate
             content.json (+ every image the session uploaded) copied
             to live, live rebuilt WITHOUT annotations, the publish
             command run ONCE
     restore → revert the last publish commit (= the whole session,
             one unit), rebuild, republish

   Only publish() (and restore()) writes inside clients/<client>/ —
   Keep included, nothing else touches live.

   SAFETY POSTURE — UI input is untrusted input. Every write still goes
   through applyPatch (allowlist, forbidden keys, container guard,
   value-type guard, safe tokens, format + contrast guards); this module
   adds nothing to the writable surface and never bypasses a guard.

   MAINTENANCE LEDGER — every attempt that flows through these handlers
   (edit | scaffold | keep | discard | discard-all | publish | restore)
   appends one JSON line
   to clients/<client>/edits.log.jsonl (gitignored; rotated at 1 MB to
   edits.log.1.jsonl): ISO timestamp, the request as submitted (uploads
   by name/size only — never file bytes), the outcome (ok | rejected |
   build-failed), and the resolver's error or refusal reason verbatim.
   Logging is a courtesy, not a control: a ledger write failure never
   blocks, fails, or alters the edit it describes.

   PER-CLIENT CONFIG — clients/<client>/owner-config.json (optional):
     {
       "clientName": "Display name",            // default: client id
       "publish": "git" | "none" | "<command>", // default: "git"
       "publishMessage": "template",            // {client} {summary}
       "contact": { "name": "...", "email": "..." },  // shown in the UI
       "host": "127.0.0.1", "port": 4173,
       "allowRemote": false,
       "accessToken": ""                        // serve.js login token; REQUIRED
     }                                          // when allowRemote is true
   "git" publishes with add/commit/push using publishMessage (which
   embeds the [blockson-publish <client>] marker restore() looks for).
   A custom command string runs with {message} and {client} substituted.
   Missing git or a failing command is reported in plain language; the
   live site stays updated locally either way.
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { applyPatch, SAFE_TOKENS, indexHosts, findItemById } = require('./patch');
const { buildEditMap } = require('./sitemap');
const scaffold = require('./scaffold');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_SUFFIX = '__candidate';
const PUBLISH_MARKER = client => `[blockson-publish ${client}]`;

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LONG_TEXT_THRESHOLD = 90;

const DEFAULT_CONFIG = {
  clientName: null,            // falls back to the client id
  publish: 'git',
  publishMessage: 'Site update ({client}): {summary} {marker}',
  contact: null,
  host: '127.0.0.1',
  port: 4173,
  allowRemote: false,
  accessToken: '',             // enforced by serve.js when non-empty; required for allowRemote
};

// ── Paths & small helpers ──────────────────────────────────────

function liveDir(session)  { return path.join(ROOT, 'clients', session.client); }
function candDir(session)  { return path.join(ROOT, 'clients', session.candidateClient); }
function liveContentPath(session) { return path.join(liveDir(session), 'content.json'); }
function candContentPath(session) { return path.join(candDir(session), 'content.json'); }
function candDistDir(session) {
  return path.join(ROOT, 'dist', session.candidateClient + '__annotated');
}

function readCandidate(session) {
  return JSON.parse(fs.readFileSync(candContentPath(session), 'utf8'));
}

function presetTokensFor(content) {
  const theme = (content.site && content.site.theme) || 'default';
  const p = path.join(ROOT, 'themes', theme, 'tokens.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function buildClient(name, annotate) {
  const args = [path.join(ROOT, 'engine', 'build.js'), name];
  if (annotate) args.push('--annotate');
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function isImagePath(v) {
  if (typeof v !== 'string') return false;
  return /^img\//i.test(v) || IMAGE_EXTS.has(path.extname(v).toLowerCase());
}

// Read a (possibly dotted) field path inside a host object. Read-only
// twin of the resolver's walk — used to derive the old/new values on
// the change card from the patch address itself.
function readFieldValue(host, field) {
  const parts = String(field).split('.');
  let cur = host;
  for (const raw of parts) {
    const k = /^\d+$/.test(raw) ? Number(raw) : raw;
    if (cur == null || typeof cur !== 'object' || !(k in cur)) return { exists: false };
    cur = cur[k];
  }
  return { exists: true, value: cur };
}

// Resolve the host a patch addresses: a block's fields, the site
// object, or an addressable item inside the block. Mirrors applyPatch.
function resolveHost(content, block, item) {
  const hosts = indexHosts(content);
  if (!hosts.has(block)) return { error: `unknown block id: "${block}"` };
  let host = hosts.get(block);
  if (item != null) {
    const found = findItemById(host, item);
    if (!found) return { error: `unknown item id "${item}" in block "${block}"` };
    host = found;
  }
  return { host };
}

function effectiveToken(content, name, presetTokens) {
  const overrides = (content.site && content.site.themeOverrides) || {};
  if (overrides[name] != null) return String(overrides[name]);
  if (presetTokens && presetTokens[name] != null) return String(presetTokens[name]);
  return null;
}

// The old/new shown on the change card come from the RESOLVED patch:
// match/append/delete carry their own old/new; set and set-token are
// read back from the content at the patch's address.
function resolveCardValue(content, patch, presetTokens) {
  if (patch.action === 'set-token') {
    return effectiveToken(content, String(patch.token).replace(/^--/, ''), presetTokens);
  }
  if (patch.action === 'delete') return null;
  if (patch.action === 'set' && typeof patch.match === 'string') return null; // handled by caller
  const r = resolveHost(content, patch.block, patch.item);
  if (r.error) return null;
  const f = readFieldValue(r.host, patch.field);
  return f.exists ? f.value : null;
}

function summarize(patch) {
  if (patch.action === 'set-token') return `set brand token --${String(patch.token).replace(/^--/, '')}`;
  if (patch.action === 'set' && patch.field === 'hidden' && patch.item == null
      && typeof patch.value === 'boolean') {
    return patch.value ? `hide the ${patch.block} section` : `show the ${patch.block} section again`;
  }
  const where = patch.item ? `${patch.block} › ${patch.item}` : patch.block;
  if (patch.action === 'append') return `add a line to ${where}.${patch.field}`;
  if (patch.action === 'delete') return `remove a line from ${where}.${patch.field}`;
  if (typeof patch.match === 'string') return `edit a line in ${where}.${patch.field}`;
  return `set ${where}.${patch.field}`;
}

function publicPending(session) {
  if (!session.pending) return null;
  const p = session.pending;
  return { summary: p.summary, old: p.old, new: p.new, patch: p.patch, at: p.at };
}

// The staged list as the UI sees it: each entry summarized from its
// resolved patch (the card derived when it was the pending change —
// upload bytes and replay records stay server-side).
function publicStaged(session) {
  return session.staged.map(s => ({ summary: s.summary, old: s.old, new: s.new, keptAt: s.keptAt }));
}

// One publish = one commit message covering the whole session.
function sessionSummary(staged) {
  if (staged.length === 1) return staged[0].summary;
  const joined = staged.map(s => s.summary).join('; ');
  const detail = joined.length > 240 ? joined.slice(0, 237) + '…' : joined;
  return `${staged.length} changes: ${detail}`;
}

function publishMode(config) {
  if (config.publish === 'none') return 'none';
  if (config.publish === 'git' || config.publish == null) return 'git';
  return 'custom';
}

// ── Maintenance ledger ─────────────────────────────────────────

const LEDGER_FILE = 'edits.log.jsonl';
const LEDGER_ROTATED = 'edits.log.1.jsonl';
const LEDGER_MAX_BYTES = 1024 * 1024;

/* Append one event line to the per-client ledger. Logging is a courtesy,
   not a control: every failure in here is swallowed by design — a ledger
   problem must never block, fail, or alter the edit it describes. */
function ledgerWrite(session, entry) {
  try {
    const file = path.join(liveDir(session), LEDGER_FILE);
    try {
      if (fs.statSync(file).size > LEDGER_MAX_BYTES) {
        const rotated = path.join(liveDir(session), LEDGER_ROTATED);
        fs.rmSync(rotated, { force: true });
        fs.renameSync(file, rotated);
      }
    } catch (e) { /* no existing ledger — nothing to rotate */ }
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  } catch (e) { /* swallowed by design — see above */ }
}

// Uploads are logged by name and size only — file bytes never enter the ledger.
function describeUpload(u) {
  if (!u || typeof u !== 'object') return null;
  let size = 0;
  try { size = Buffer.byteLength(String(u.dataBase64 || ''), 'base64'); } catch (e) {}
  return { name: typeof u.name === 'string' ? u.name : null, size };
}

function describeScaffoldRequest(req) {
  if (!req || typeof req !== 'object') return null;
  const out = { blueprint: req.blueprint, variant: req.variant };
  if (req.targetPage != null) out.targetPage = req.targetPage;
  if (req.values && typeof req.values === 'object') out.values = req.values;
  if (req.uploads && typeof req.uploads === 'object') {
    out.uploads = {};
    for (const k of Object.keys(req.uploads)) out.uploads[k] = describeUpload(req.uploads[k]);
  }
  return out;
}

// Keep/discard act on the pending change, so the "request" their ledger
// line records is that pending change as it stood when the handler ran.
function describePendingRequest(session) {
  const p = session.pending;
  if (!p) return null;
  const out = { summary: p.summary };
  if (p.patch) out.patch = p.patch;
  if (p.scaffold) out.scaffold = p.scaffold;
  return out;
}

// Publish/discard-all act on the whole session, so their ledger line
// records the staged list (by summary) as it stood when the handler ran.
function describeSessionRequest(session) {
  return { staged: session.staged.map(s => s.summary) };
}

/* Wrap a handler so every call appends one ledger line at this boundary —
   the chokepoint all UI edits, scaffolds, keeps, publishes, and discards
   flow through, whoever the caller is. The request is captured BEFORE the
   handler runs (keep/discard clear session.pending, publish/discard-all
   clear session.staged); the outcome is read off the handler's own
   result. */
function logged(event, fn, describe) {
  return function (session, ...args) {
    let request = null;
    try { request = describe ? describe(session, ...args) : null; } catch (e) {}
    let result;
    try { result = fn(session, ...args); }
    catch (e) {
      ledgerWrite(session, { event, request, outcome: 'rejected', error: e.message });
      throw e;
    }
    const entry = { event, request, outcome: result.ok ? 'ok' : (result.buildFailed ? 'build-failed' : 'rejected') };
    const reason = result.ok ? null : (result.error || result.reason);
    if (reason) entry.error = reason;
    ledgerWrite(session, entry);
    return result;
  };
}

// ── Config & session ───────────────────────────────────────────

function loadConfig(client) {
  const p = path.join(ROOT, 'clients', client, 'owner-config.json');
  let fileCfg = {};
  if (fs.existsSync(p)) {
    try { fileCfg = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { throw new Error(`owner-config.json is not valid JSON: ${e.message}`); }
  }
  return { ...DEFAULT_CONFIG, ...fileCfg };
}

/* Create an editing session: reset the candidate from live and build the
   annotated preview. Pending and staged state is in-memory, so a fresh
   session always starts clean — candidate equals live, nothing pending,
   nothing staged. */
function createSession(client, overrides) {
  if (!/^[a-zA-Z0-9_-]+$/.test(client || '')) {
    throw new Error(`invalid client name "${client}"`);
  }
  const session = {
    client,
    candidateClient: client + CANDIDATE_SUFFIX,
    config: { ...loadConfig(client), ...(overrides || {}) },
    pending: null,
    staged: [],
    lastPublish: null,
  };
  if (!fs.existsSync(liveContentPath(session))) {
    throw new Error(`clients/${client}/content.json not found`);
  }
  resetCandidate(session);
  const b = buildCandidate(session);
  if (!b.ok) throw new Error(`the live content does not build — fix it before editing:\n${b.out}`);
  return session;
}

function resetCandidate(session) {
  fs.rmSync(candDir(session), { recursive: true, force: true });
  // The ledger is a live-dir-only artifact, not site content — it never
  // rides along into the candidate copy.
  fs.cpSync(liveDir(session), candDir(session), {
    recursive: true,
    filter: src => !path.basename(src).startsWith('edits.log'),
  });
}

function buildCandidate(session) { return buildClient(session.candidateClient, true); }
function buildLive(session)      { return buildClient(session.client, false); }

// ── Handlers ───────────────────────────────────────────────────

function getState(session) {
  const content = readCandidate(session);
  const preset = presetTokensFor(content);
  return {
    ok: true,
    client: session.client,
    clientName: session.config.clientName || session.client,
    contact: session.config.contact || null,
    publishMode: publishMode(session.config),
    pending: publicPending(session),
    staged: publicStaged(session),
    lastPublish: session.lastPublish,
    tokens: buildEditMap(content, preset).tokens,
    pages: (content.pages || []).map(p => p.slug),
  };
}

/* Describe one editable field so the UI can open the right editor.
   `ref` comes straight from the data-bk-* attributes of the clicked
   element: { block, item?, field, index? }. The current value is read
   from the CANDIDATE content — the same content a staged patch will be
   resolved against. */
function describeField(session, ref) {
  const res = describeFieldValue(session, ref);
  // Block-level visibility state rides along on every successful field
  // description, so the editor pane can offer the section's hide/show
  // toggle next to whichever field was clicked. Absent flag → no toggle.
  if (res.ok && ref && ref.block !== 'site') {
    const fields = indexHosts(readCandidate(session)).get(ref.block);
    if (fields && typeof fields.hidden === 'boolean') res.blockHidden = fields.hidden;
  }
  return res;
}

function describeFieldValue(session, ref) {
  if (!ref || typeof ref.block !== 'string' || typeof ref.field !== 'string') {
    return { ok: false, error: 'a field reference needs at least "block" and "field"' };
  }
  const content = readCandidate(session);
  const r = resolveHost(content, ref.block, ref.item != null ? ref.item : null);
  if (r.error) return { ok: false, error: r.error };
  const f = readFieldValue(r.host, ref.field);
  if (!f.exists) return { ok: false, error: `field "${ref.field}" does not exist on "${ref.block}"` };
  const v = f.value;

  // A single line of a flat text list (annotated with data-bk-index).
  if (ref.index != null && ref.index !== '') {
    const idx = Number(ref.index);
    if (!Array.isArray(v) || !Number.isInteger(idx) || idx < 0 || idx >= v.length) {
      return { ok: false, error: `"${ref.field}" has no line ${ref.index}` };
    }
    return { ok: true, kind: 'list-line', field: ref.field, value: v[idx], lines: v.slice() };
  }

  if (Array.isArray(v)) {
    if (v.some(el => el !== null && typeof el === 'object')) {
      return { ok: false, error: `"${ref.field}" is a structured list — its items are edited individually` };
    }
    const kind = v.length && v.every(isImagePath) ? 'image-list' : 'text-list';
    return { ok: true, kind, field: ref.field, lines: v.slice() };
  }
  if (v !== null && typeof v === 'object') {
    return { ok: false, error: `"${ref.field}" is a container; its inner values are edited individually` };
  }
  if (isImagePath(v)) return { ok: true, kind: 'image', field: ref.field, value: v };
  if (typeof v === 'boolean') return { ok: true, kind: 'toggle', field: ref.field, value: v };
  if (typeof v === 'number') return { ok: true, kind: 'text', field: ref.field, value: v, valueType: 'number' };
  const s = String(v == null ? '' : v);
  const kind = (s.includes('\n') || s.length > LONG_TEXT_THRESHOLD) ? 'long-text' : 'text';
  return { ok: true, kind, field: ref.field, value: s };
}

/* Run the token guards (format + contrast) against the CANDIDATE content
   without writing anything — the live feedback behind the color picker.
   The plain-language explanation IS the resolver's own error message. */
function checkToken(session, token, value) {
  const clone = readCandidate(session); // fresh parse — mutating it touches nothing
  const result = applyPatch(clone, { action: 'set-token', token: String(token), value: String(value) },
    presetTokensFor(clone));
  return result.ok ? { ok: true } : { ok: false, error: result.error || 'rejected' };
}

// File-signature (magic-byte) check: the bytes must actually be the image
// format the extension claims. Extension alone is the browser's word for it;
// the bytes are checked here so a non-image can never reach the live img/
// directory under an image name (a rejected upload is an acceptable UX cost;
// a published non-image is not).
const IMAGE_SIGNATURES = {
  '.png':  b => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
                && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A,
  '.jpg':  b => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  '.jpeg': b => IMAGE_SIGNATURES['.jpg'](b),
  '.gif':  b => b.length >= 6 && b.toString('latin1', 0, 6).match(/^GIF8[79]a$/) !== null,
  '.webp': b => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF'
                && b.toString('latin1', 8, 12) === 'WEBP',
  '.avif': b => b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp'
                && /^(avif|avis)$/.test(b.toString('latin1', 8, 12)),
};

// Validate + decide the final filename for an uploaded image. Never
// overwrites: a name collision (on disk, or with another upload staged
// in the same request via `taken`) gets a numeric suffix.
function prepareUpload(session, upload, taken) {
  if (!upload || typeof upload.name !== 'string' || typeof upload.dataBase64 !== 'string') {
    return { error: 'an image upload needs "name" and "dataBase64"' };
  }
  let base = path.basename(upload.name).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const ext = path.extname(base).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    return { error: `"${path.basename(upload.name)}" is not a supported image — use ${[...IMAGE_EXTS].join(', ')}` };
  }
  const stem = (base.slice(0, -ext.length).replace(/^[.\-]+/, '').slice(0, 60)) || 'image';
  let bytes;
  try { bytes = Buffer.from(upload.dataBase64, 'base64'); } catch (e) { bytes = null; }
  if (!bytes || bytes.length === 0) return { error: 'the uploaded image was empty' };
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { error: `the image is too large (${(bytes.length / 1048576).toFixed(1)} MB — the limit is ${MAX_IMAGE_BYTES / 1048576} MB)` };
  }
  if (!IMAGE_SIGNATURES[ext](bytes)) {
    return { error: `"${path.basename(upload.name)}" does not look like a real ${ext.slice(1).toUpperCase()} image — the file's contents don't match its name` };
  }
  const imgDir = path.join(candDir(session), 'img');
  const inUse = name => fs.existsSync(path.join(imgDir, name)) || (taken && taken.has(name));
  let name = stem + ext;
  for (let n = 2; inUse(name); n++) name = `${stem}-${n}${ext}`;
  return { name, bytes, imgDir };
}

/* The edit handler: construct → applyPatch on the candidate → candidate
   rebuild (annotated) → pending change card. Exactly one pending change
   at a time. On any failure nothing is left written. */
function applyEdit(session, patch, upload) {
  if (session.pending) {
    return { ok: false, error: 'There is already a pending change — keep or discard it first.' };
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'patch is not an object' };
  }
  patch = { ...patch }; // never mutate the caller's object
  if (!['set', 'append', 'delete', 'set-token'].includes(patch.action)) {
    return { ok: false, error: `unsupported action "${patch.action}"` };
  }

  // Image edits: the file is validated and named HERE, and the patch value
  // is the path this module assigned — the browser never picks the path.
  let staged = null;
  if (upload != null) {
    if (patch.action !== 'set' && patch.action !== 'append') {
      return { ok: false, error: 'an image upload must come with a set or append patch' };
    }
    const prep = prepareUpload(session, upload);
    if (prep.error) return { ok: false, error: prep.error };
    staged = prep;
    patch.value = 'img/' + prep.name;
  }

  const beforeText = fs.readFileSync(candContentPath(session), 'utf8');
  const content = JSON.parse(beforeText);
  const presetTokens = presetTokensFor(content);

  // If the field currently holds a number and the UI sent a numeric string,
  // keep the type — the schema gate at build time expects it.
  if (patch.action === 'set' && typeof patch.match !== 'string' && typeof patch.value === 'string') {
    const r = resolveHost(content, patch.block, patch.item);
    if (!r.error) {
      const f = readFieldValue(r.host, patch.field);
      if (f.exists && typeof f.value === 'number' && patch.value.trim() !== '' && Number.isFinite(Number(patch.value))) {
        patch.value = Number(patch.value);
      }
    }
  }

  // Old value, derived by resolving the patch address (match-form patches
  // carry their old value in the patch itself).
  const oldValue = (patch.action === 'set' && typeof patch.match === 'string') ? patch.match
                 : (patch.action === 'delete') ? (patch.match != null ? patch.match : null)
                 : (patch.action === 'append') ? null
                 : resolveCardValue(content, patch, presetTokens);

  const result = applyPatch(content, patch, presetTokens);
  if (result.refused) return { ok: false, error: result.reason || 'refused' };
  if (!result.ok) return { ok: false, error: result.error };

  let uploadPath = null;
  if (staged) {
    fs.mkdirSync(staged.imgDir, { recursive: true });
    uploadPath = path.join(staged.imgDir, staged.name);
    fs.writeFileSync(uploadPath, staged.bytes);
  }
  fs.writeFileSync(candContentPath(session), JSON.stringify(content, null, 2) + '\n', 'utf8');

  const b = buildCandidate(session);
  if (!b.ok) {
    fs.writeFileSync(candContentPath(session), beforeText, 'utf8');
    if (uploadPath) fs.rmSync(uploadPath, { force: true });
    buildCandidate(session); // restore the preview to the last good state
    return { ok: false, buildFailed: true, error: `That change did not pass the site's checks, so it was not kept:\n${b.out}` };
  }

  const newValue = (patch.action === 'delete') ? null
                 : (patch.action === 'set-token' || (patch.action === 'set' && typeof patch.match !== 'string'))
                   ? resolveCardValue(content, patch, presetTokens)
                   : patch.value;

  session.pending = {
    patch,
    old: oldValue,
    new: newValue,
    summary: summarize(patch),
    uploads: staged ? [staged.name] : [],
    // Bytes kept for the staged-list replay (discard-pending rebuilds the
    // candidate from live + staged, which must rewrite this file).
    uploadFiles: staged ? [{ name: staged.name, bytes: staged.bytes }] : [],
    at: new Date().toISOString(),
  };
  return { ok: true, pending: publicPending(session) };
}

/* List the blueprint registry for the Add… menu. Invalid blueprint
   files are excluded by the loader and reported with named reasons —
   the validator is the sole gate, whoever authored the file. */
function listBlueprints() {
  const loaded = scaffold.loadBlueprints();
  return {
    ok: true,
    blueprints: loaded.blueprints.map(({ key, blueprint }) => ({
      key,
      name: blueprint.name,
      purpose: blueprint.purpose,
      kind: blueprint.kind,
      variants: blueprint.variants,
      inputs: blueprint.inputs,
    })),
    invalid: loaded.invalid,
  };
}

/* The structural counterpart of applyEdit: instantiate a blueprint into
   the CANDIDATE copy → candidate rebuild (annotated; the full build is
   the acceptance gate) → pending change card. Same one-pending-change
   rule, same rollback-on-failure, same keep/discard flow afterwards.
   Never touches applyPatch — structure arrives only through scaffold.js. */
function applyScaffold(session, req) {
  if (session.pending) {
    return { ok: false, error: 'There is already a pending change — keep or discard it first.' };
  }
  if (!req || typeof req !== 'object') return { ok: false, error: 'bad scaffold request' };
  const loaded = scaffold.loadBlueprints();
  const entry = loaded.blueprints.find(b => b.key === req.blueprint);
  if (!entry) return { ok: false, error: `unknown blueprint "${req.blueprint}"` };
  const bp = entry.blueprint;
  if (!(bp.variants || []).some(v => v.key === req.variant)) {
    return { ok: false, error: `unknown layout "${req.variant}" for ${bp.name}` };
  }

  // Image inputs may arrive as uploads; like applyEdit, the file is
  // validated and its img/ path assigned HERE, never by the browser.
  const values = { ...(req.values && typeof req.values === 'object' ? req.values : {}) };
  const staged = [];
  if (req.uploads && typeof req.uploads === 'object') {
    const active = scaffold.activeInputs(bp, req.variant);
    const taken = new Set();
    for (const key of Object.keys(req.uploads)) {
      const inp = active.find(i => i.key === key && i.type === 'image');
      if (!inp) return { ok: false, error: `"${key}" does not accept an image upload` };
      const prep = prepareUpload(session, req.uploads[key], taken);
      if (prep.error) return { ok: false, error: prep.error };
      taken.add(prep.name);
      staged.push(prep);
      values[key] = 'img/' + prep.name;
    }
  }

  const beforeText = fs.readFileSync(candContentPath(session), 'utf8');
  const content = JSON.parse(beforeText);
  const inst = scaffold.instantiate(content, bp, req.variant, values, { targetSlug: req.targetPage });
  if (!inst.ok) return { ok: false, error: inst.errors.join('\n') };

  const written = [];
  for (const s of staged) {
    fs.mkdirSync(s.imgDir, { recursive: true });
    const p = path.join(s.imgDir, s.name);
    fs.writeFileSync(p, s.bytes);
    written.push(p);
  }
  fs.writeFileSync(candContentPath(session), JSON.stringify(content, null, 2) + '\n', 'utf8');

  const b = buildCandidate(session);
  if (!b.ok) {
    fs.writeFileSync(candContentPath(session), beforeText, 'utf8');
    for (const p of written) fs.rmSync(p, { force: true });
    buildCandidate(session); // restore the preview to the last good state
    return { ok: false, buildFailed: true, error: `That addition did not pass the site's checks, so it was not kept:\n${b.out}` };
  }

  const c = inst.created;
  session.pending = {
    patch: null,
    scaffold: { blueprint: entry.key, variant: req.variant },
    // The full request as resolved here (image paths already assigned), so
    // the staged-list replay can re-instantiate it deterministically.
    replayScaffold: { blueprint: entry.key, variant: req.variant, values, targetPage: req.targetPage },
    old: null,
    new: c.kind === 'page'
      ? `New page "${c.navLabel}" (${c.file}) with ${c.blockIds.length} section(s), added to the menu`
      : `New section on ${c.file}`,
    summary: c.kind === 'page' ? `add page "${c.navLabel}" (${c.file})` : `add a section to ${c.slug}`,
    uploads: staged.map(s => s.name),
    uploadFiles: staged.map(s => ({ name: s.name, bytes: s.bytes })),
    at: new Date().toISOString(),
  };
  return { ok: true, pending: publicPending(session), created: c };
}

/* Keep: the pending change joins the session's staged list and the next
   edit can begin. The change is already applied to the candidate, so this
   writes nothing; its old → new card was derived by resolving the patch
   against the candidate content when the change was constructed, and the
   candidate cannot have moved since (every mutating handler refuses while
   a change is pending) — that card travels with the entry verbatim. */
function keep(session) {
  if (!session.pending) return { ok: false, error: 'There is no pending change to keep.' };
  const p = session.pending;
  session.staged.push({
    summary: p.summary,
    old: p.old,
    new: p.new,
    patch: p.patch,
    scaffold: p.scaffold || null,
    replay: p.patch
      ? { kind: 'patch', patch: p.patch }
      : { kind: 'scaffold', ...p.replayScaffold },
    uploads: p.uploads,
    uploadFiles: p.uploadFiles,
    keptAt: new Date().toISOString(),
  });
  session.pending = null;
  return { ok: true, staged: publicStaged(session) };
}

/* Rebuild the candidate as live + the staged list, by REPLAY: reset from
   live, then re-apply every staged change in order through the same gates
   it originally passed (applyPatch for patches, scaffold.instantiate for
   scaffolds — both deterministic, both already validated) and rewrite the
   session's uploaded files. This is how discard-pending leaves the staged
   list undisturbed without ever trying to invert a patch. */
function replayStaged(session) {
  resetCandidate(session);
  const content = JSON.parse(fs.readFileSync(candContentPath(session), 'utf8'));
  const presetTokens = presetTokensFor(content);
  for (const entry of session.staged) {
    if (entry.replay.kind === 'patch') {
      const r = applyPatch(content, { ...entry.replay.patch }, presetTokens);
      if (!r.ok) {
        return { ok: false, error: `replaying a kept change failed unexpectedly: ${r.error || r.reason}` };
      }
    } else {
      const loaded = scaffold.loadBlueprints();
      const e = loaded.blueprints.find(b => b.key === entry.replay.blueprint);
      if (!e) return { ok: false, error: `replaying a kept addition failed: unknown blueprint "${entry.replay.blueprint}"` };
      const inst = scaffold.instantiate(content, e.blueprint, entry.replay.variant,
        entry.replay.values, { targetSlug: entry.replay.targetPage });
      if (!inst.ok) {
        return { ok: false, error: `replaying a kept addition failed unexpectedly:\n${inst.errors.join('\n')}` };
      }
    }
    for (const f of entry.uploadFiles) {
      const dir = path.join(candDir(session), 'img');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, f.name), f.bytes);
    }
  }
  fs.writeFileSync(candContentPath(session), JSON.stringify(content, null, 2) + '\n', 'utf8');
  const b = buildCandidate(session);
  if (!b.ok) return { ok: false, buildFailed: true, error: `candidate rebuild failed:\n${b.out}` };
  return { ok: true };
}

/* Discard: drop the PENDING change only. The candidate is reconstructed
   from live plus the staged list — kept changes are never disturbed. */
function discard(session) {
  if (!session.pending) return { ok: false, error: 'There is no pending change to discard.' };
  session.pending = null;
  return replayStaged(session);
}

/* Discard all: reset the candidate from live and empty the session —
   pending change, staged list, and the session's uploads all vanish. */
function discardAll(session) {
  session.pending = null;
  session.staged = [];
  resetCandidate(session);
  const b = buildCandidate(session);
  if (!b.ok) return { ok: false, buildFailed: true, error: `candidate rebuild failed:\n${b.out}` };
  return { ok: true };
}

/* Publish: the ONLY path that writes into clients/<client>/ (restore
   aside). Writes the entire staged session to live in one step — the
   candidate content plus every image the session uploaded — rebuilds
   live WITHOUT annotations, then runs the publish command ONCE. */
function publish(session) {
  if (session.pending) {
    return { ok: false, error: 'Keep or discard the pending change before publishing.' };
  }
  if (session.staged.length === 0) {
    return { ok: false, error: 'There is nothing to publish — keep at least one change first.' };
  }

  const liveBackup = fs.readFileSync(liveContentPath(session), 'utf8');
  fs.writeFileSync(liveContentPath(session), fs.readFileSync(candContentPath(session), 'utf8'), 'utf8');

  const copied = [];
  for (const entry of session.staged) {
    for (const name of entry.uploads) {
      const src = path.join(candDir(session), 'img', name);
      const dst = path.join(liveDir(session), 'img', name);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied.push(dst);
    }
  }

  const b = buildLive(session);
  if (!b.ok) {
    // Should be impossible (the same content already built as the candidate)
    // — but never leave live updated-and-broken. Roll everything back.
    fs.writeFileSync(liveContentPath(session), liveBackup, 'utf8');
    for (const f of copied) fs.rmSync(f, { force: true });
    buildLive(session);
    return { ok: false, buildFailed: true, error: `The live rebuild failed unexpectedly; the live site was left unchanged:\n${b.out}` };
  }

  const summary = sessionSummary(session.staged);
  session.staged = [];
  const result = runPublish(session, summary);
  session.lastPublish = { at: new Date().toISOString(), ok: result.ok, message: result.message };
  return { ok: true, publish: result };
}

/* Restore: revert the last publish commit (found by the marker the
   default publish message embeds), rebuild live + candidate, republish.
   One publish = one commit = the whole session, so restore reverts the
   whole session as one unit. */
function restore(session) {
  if (session.pending || session.staged.length) {
    return { ok: false, error: 'Publish or discard your changes before restoring a previous version.' };
  }
  let log = git(['log', '-n', '1', '--fixed-strings', '--grep', PUBLISH_MARKER(session.client), '--format=%H']);
  if (log.error && log.error.code === 'ENOENT') {
    return { ok: false, error: 'git is not installed (or not on PATH), so there is no publish history to restore from.' };
  }
  const hash = (log.stdout || '').trim();
  if (log.status !== 0 || !hash) {
    return { ok: false, error: 'No published change was found for this client — nothing to restore.' };
  }
  const revert = git(['revert', '--no-edit', hash]);
  if (revert.status !== 0) {
    git(['revert', '--abort']);
    return { ok: false, error: `Could not undo the last publish automatically:\n${((revert.stdout || '') + (revert.stderr || '')).trim()}` };
  }

  resetCandidate(session);
  const live = buildLive(session);
  const cand = buildCandidate(session);
  if (!live.ok || !cand.ok) {
    return { ok: false, buildFailed: true, error: `The undo was committed but the rebuild failed:\n${(live.ok ? '' : live.out)}\n${(cand.ok ? '' : cand.out)}`.trim() };
  }

  let publish;
  const mode = publishMode(session.config);
  if (mode === 'git') {
    const push = git(['push']);
    publish = push.status === 0
      ? { ok: true, message: 'The previous version is live again (reverted and pushed).' }
      : { ok: false, message: `Reverted locally, but the push failed:\n${((push.stdout || '') + (push.stderr || '')).trim()}` };
  } else if (mode === 'custom') {
    publish = runPublish(session, `restore previous version`);
  } else {
    publish = { ok: true, skipped: true, message: 'Reverted locally. Publishing is turned off for this client.' };
  }
  session.lastPublish = { at: new Date().toISOString(), ok: publish.ok, message: publish.message };
  return { ok: true, publish };
}

// ── Publish ────────────────────────────────────────────────────

function publishMessageFor(session, summary) {
  return String(session.config.publishMessage || DEFAULT_CONFIG.publishMessage)
    .replace(/\{client\}/g, session.client)
    .replace(/\{summary\}/g, summary || 'content update')
    .replace(/\{marker\}/g, PUBLISH_MARKER(session.client));
}

function runPublish(session, summary) {
  const mode = publishMode(session.config);
  if (mode === 'none') {
    return { ok: true, skipped: true, message: 'Saved and rebuilt locally. Publishing is turned off for this client (publish: "none").' };
  }
  const message = publishMessageFor(session, summary);

  if (mode === 'custom') {
    // {message} is interpolated into a SHELL command, so it is reduced to a
    // conservative character set first (the summary embeds free-form owner
    // text such as a blueprint's menu label). The git path below needs no
    // such reduction — there the message travels as a spawn argument.
    const shellSafeMessage = message.replace(/[^\w \[\]().,:'/-]+/g, ' ').trim();
    const cmd = String(session.config.publish)
      .replace(/\{message\}/g, shellSafeMessage)
      .replace(/\{client\}/g, session.client);
    const r = spawnSync(cmd, { shell: true, cwd: ROOT, encoding: 'utf8' });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    if (r.error) return { ok: false, message: `The publish command could not be run: ${r.error.message}. The site was updated locally but not published.` };
    return r.status === 0
      ? { ok: true, message: 'Published.' }
      : { ok: false, message: `The publish command failed (the site was updated locally but not published):\n${out}` };
  }

  // mode === 'git' (default): add → commit → push, with plain-language
  // failure messages at each step.
  const probe = git(['--version']);
  if (probe.error && probe.error.code === 'ENOENT') {
    return { ok: false, message: 'git is not installed (or not on PATH). The site was updated locally but not published.' };
  }
  const toAdd = [path.join('clients', session.client, 'content.json')];
  if (fs.existsSync(path.join(liveDir(session), 'img'))) {
    toAdd.push(path.join('clients', session.client, 'img'));
  }
  const add = git(['add', '--', ...toAdd]);
  if (add.status !== 0) {
    return { ok: false, message: `Could not stage the change for publishing:\n${(add.stderr || '').trim()}` };
  }
  const commit = git(['commit', '-m', message]);
  if (commit.status !== 0) {
    return { ok: false, message: `Could not record the change for publishing:\n${((commit.stdout || '') + (commit.stderr || '')).trim()}` };
  }
  const push = git(['push']);
  if (push.status !== 0) {
    return { ok: false, message: `The change was saved and recorded, but sending it to the host failed (it will go out with the next successful publish):\n${((push.stdout || '') + (push.stderr || '')).trim()}` };
  }
  return { ok: true, message: 'Published — the change is on its way to the live site.' };
}

module.exports = {
  createSession, getState, describeField, checkToken,
  // The maintenance-tier handlers are exported through the ledger
  // boundary: one JSONL line per attempt, whoever the caller is.
  applyEdit: logged('edit', applyEdit,
    (session, patch, upload) => (upload != null ? { patch, upload: describeUpload(upload) } : { patch })),
  applyScaffold: logged('scaffold', applyScaffold,
    (session, req) => describeScaffoldRequest(req)),
  listBlueprints,
  keep: logged('keep', keep, describePendingRequest),
  discard: logged('discard', discard, describePendingRequest),
  discardAll: logged('discard-all', discardAll, describeSessionRequest),
  publish: logged('publish', publish, describeSessionRequest),
  restore: logged('restore', restore, null),
  loadConfig, resetCandidate, buildCandidate, buildLive,
  candDistDir, candContentPath, liveContentPath,
  CANDIDATE_SUFFIX, SAFE_TOKENS,
};
