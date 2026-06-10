/* ============================================================
   engine/lib/owner.js — Owner-editor request handlers (v4, Task 2)

   The deterministic core of the click-to-edit owner UI. Every handler
   the HTTP server (engine/serve.js) exposes lives here as a plain
   function over a session object, so the proof suite can exercise the
   full edit → candidate → approve cycle DIRECTLY, with no socket
   (proof 8).

   THE CANDIDATE MODEL
   Live content is clients/<client>/. The session works on a full copy,
   clients/<client>__candidate/ (gitignored), built ANNOTATED to
   dist/<client>__candidate__annotated/ — that build is the preview the
   owner sees. Exactly one pending change exists at a time:

     edit  → patch constructed deterministically (the UI never invents
             values for paths; image paths are assigned here)
           → applyPatch on the CANDIDATE content (all guards run)
           → candidate rebuild (annotated); a failing build rolls the
             candidate back — a bad change can never stick
           → pending card: old → new, both read by resolving the patch
             address against the candidate content (never from any
             other description of the change)
     approve → candidate content.json (+ any uploaded images) copied to
             live, live rebuilt WITHOUT annotations, publish command run
     discard → candidate reset from live, rebuilt
     restore → revert the last publish commit, rebuild, republish

   Only approve() writes inside clients/<client>/ — the candidate
   directory cannot leak into live through any other path.

   SAFETY POSTURE — UI input is untrusted input. Every write still goes
   through applyPatch (allowlist, forbidden keys, container guard,
   value-type guard, safe tokens, format + contrast guards); this module
   adds nothing to the writable surface and never bypasses a guard.

   PER-CLIENT CONFIG — clients/<client>/owner-config.json (optional):
     {
       "clientName": "Display name",            // default: client id
       "publish": "git" | "none" | "<command>", // default: "git"
       "publishMessage": "template",            // {client} {summary}
       "contact": { "name": "...", "email": "..." },  // shown in the UI
       "host": "127.0.0.1", "port": 4173,
       "allowRemote": false
     }
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
  const where = patch.item ? `${patch.block} › ${patch.item}` : patch.block;
  if (patch.action === 'append') return `add a line to ${where}.${patch.field}`;
  if (patch.action === 'delete') return `remove a line from ${where}.${patch.field}`;
  if (typeof patch.match === 'string') return `edit a line in ${where}.${patch.field}`;
  return `set ${where}.${patch.field}`;
}

function publicPending(session) {
  if (!session.pending) return null;
  const p = session.pending;
  return { summary: p.summary, old: p.old, new: p.new, patch: p.patch, stagedAt: p.stagedAt };
}

function publishMode(config) {
  if (config.publish === 'none') return 'none';
  if (config.publish === 'git' || config.publish == null) return 'git';
  return 'custom';
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
   annotated preview. Pending state is in-memory, so a fresh session always
   starts clean — candidate equals live, nothing pending. */
function createSession(client, overrides) {
  if (!/^[a-zA-Z0-9_-]+$/.test(client || '')) {
    throw new Error(`invalid client name "${client}"`);
  }
  const session = {
    client,
    candidateClient: client + CANDIDATE_SUFFIX,
    config: { ...loadConfig(client), ...(overrides || {}) },
    pending: null,
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
  fs.cpSync(liveDir(session), candDir(session), { recursive: true });
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

// Validate + decide the final filename for an uploaded image. Never
// overwrites: a name collision gets a numeric suffix.
function prepareUpload(session, upload) {
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
  const imgDir = path.join(candDir(session), 'img');
  let name = stem + ext;
  for (let n = 2; fs.existsSync(path.join(imgDir, name)); n++) name = `${stem}-${n}${ext}`;
  return { name, bytes, imgDir };
}

/* The edit handler: construct → applyPatch on the candidate → candidate
   rebuild (annotated) → pending change card. Exactly one pending change
   at a time. On any failure nothing is left written. */
function applyEdit(session, patch, upload) {
  if (session.pending) {
    return { ok: false, error: 'There is already a pending change — approve or discard it first.' };
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
    return { ok: false, error: `That change did not pass the site's checks, so it was not kept:\n${b.out}` };
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
    stagedAt: new Date().toISOString(),
  };
  return { ok: true, pending: publicPending(session) };
}

/* Approve: the ONLY path that writes into clients/<client>/. Copies the
   candidate content (and any image the pending change uploaded) to live,
   rebuilds live WITHOUT annotations, then runs the publish command. */
function approve(session) {
  if (!session.pending) return { ok: false, error: 'There is no pending change to approve.' };

  const liveBackup = fs.readFileSync(liveContentPath(session), 'utf8');
  fs.writeFileSync(liveContentPath(session), fs.readFileSync(candContentPath(session), 'utf8'), 'utf8');

  const copied = [];
  for (const name of session.pending.uploads) {
    const src = path.join(candDir(session), 'img', name);
    const dst = path.join(liveDir(session), 'img', name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied.push(dst);
  }

  const b = buildLive(session);
  if (!b.ok) {
    // Should be impossible (the same content already built as the candidate)
    // — but never leave live updated-and-broken. Roll everything back.
    fs.writeFileSync(liveContentPath(session), liveBackup, 'utf8');
    for (const f of copied) fs.rmSync(f, { force: true });
    buildLive(session);
    return { ok: false, error: `The live rebuild failed unexpectedly; the live site was left unchanged:\n${b.out}` };
  }

  const summary = session.pending.summary;
  session.pending = null;
  const publish = runPublish(session, summary);
  session.lastPublish = { at: new Date().toISOString(), ok: publish.ok, message: publish.message };
  return { ok: true, publish };
}

/* Discard: reset the candidate from live and rebuild the preview. */
function discard(session) {
  session.pending = null;
  resetCandidate(session);
  const b = buildCandidate(session);
  if (!b.ok) return { ok: false, error: `candidate rebuild failed:\n${b.out}` };
  return { ok: true };
}

/* Restore: revert the last publish commit (found by the marker the
   default publish message embeds), rebuild live + candidate, republish. */
function restore(session) {
  if (session.pending) {
    return { ok: false, error: 'Approve or discard the pending change before restoring a previous version.' };
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
    return { ok: false, error: `The undo was committed but the rebuild failed:\n${(live.ok ? '' : live.out)}\n${(cand.ok ? '' : cand.out)}`.trim() };
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
    const cmd = String(session.config.publish)
      .replace(/\{message\}/g, message.replace(/"/g, "'"))
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
  applyEdit, approve, discard, restore,
  loadConfig, resetCandidate, buildCandidate, buildLive,
  candDistDir, candContentPath, liveContentPath,
  CANDIDATE_SUFFIX, SAFE_TOKENS,
};
