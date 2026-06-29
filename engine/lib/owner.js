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

     edit / scaffold / remove-item
           → constructed deterministically (the UI never
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
   (edit | scaffold | remove-item | keep | discard | discard-all |
   publish | restore) appends one JSON line
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

// All side effects (candidate + live content I/O, image bytes, the
// preview/live builds, publish, and the maintenance ledger) are delegated to
// an injected `session.host`; see engine/lib/host-node.js for the default
// (disk/git) host. owner.js itself is pure orchestration — the same code runs
// in a browser against an in-memory host (the no-install demo editor), where
// the ONLY difference is that publishing is a no-op. `path` is used here for
// nothing but pure string ops (basename/extname) on upload filenames.
const path = require('path');

const { applyPatch, SAFE_TOKENS, indexHosts, findItemById, blockTypeById, CREATABLE_FIELDS, creatableFieldsFor } = require('./patch');
const { buildEditMap } = require('./sitemap');
const scaffold = require('./scaffold');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LONG_TEXT_THRESHOLD = 90;
// A gallery album with this many photos (or more) is heavy enough to slow the
// page; the editor shows a friendly heads-up at this count. A SOFT nudge, never
// a cap — there is no upper bound on photos, and the size limit above is the
// only hard guard (see prepareUpload). Tune the number, not the never-block rule.
const GALLERY_PHOTOS_HEAVY_AFTER = 12;

// ── Small helpers ──────────────────────────────────────────────

function readCandidate(session) {
  return JSON.parse(session.host.readCandidateText());
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

// ── Maintenance ledger ─────────────────────────────────────────
// The ledger is appended at the `logged` boundary below via
// session.host.ledgerAppend(entry); WHERE the line lands (disk, rotated at
// 1 MB, for the Node host; nowhere, for the demo host) is the host's concern.

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
  if (req.targetBlock != null) out.targetBlock = req.targetBlock;
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
  if (p.removeItem) out.removeItem = p.removeItem;
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
      session.host.ledgerAppend({ event, request, outcome: 'rejected', error: e.message });
      throw e;
    }
    const entry = { event, request, outcome: result.ok ? 'ok' : (result.buildFailed ? 'build-failed' : 'rejected') };
    const reason = result.ok ? null : (result.error || result.reason);
    if (reason) entry.error = reason;
    session.host.ledgerAppend(entry);
    return result;
  };
}

// ── Session ────────────────────────────────────────────────────

/* Create an editing session: reset the candidate from live and build the
   annotated preview. Pending and staged state is in-memory, so a fresh
   session always starts clean — candidate equals live, nothing pending,
   nothing staged.

   `host` is the storage/environment adapter (see engine/lib/host-node.js).
   It is OPTIONAL: when omitted, the default Node (disk/git) host is built for
   `client` + `overrides`, so existing callers — engine/serve.js and the proof
   suite — are unchanged. The browser demo passes its own in-memory host. */
function createSession(client, overrides, host) {
  host = host || require('./host-node').createNodeHost(client, overrides);
  const session = {
    client,
    config: host.config,
    pending: null,
    staged: [],
    lastPublish: null,
    host,
  };
  if (!host.liveExists()) {
    throw new Error(`clients/${client}/content.json not found`);
  }
  host.resetCandidateFromLive();
  const b = host.buildCandidate();
  if (!b.ok) throw new Error(`the live content does not build — fix it before editing:\n${b.out}`);
  return session;
}

// ── Handlers ───────────────────────────────────────────────────

function getState(session) {
  const content = readCandidate(session);
  const preset = session.host.presetTokens(content);
  return {
    ok: true,
    client: session.client,
    clientName: session.config.clientName || session.client,
    contact: session.config.contact || null,
    publishMode: session.host.publishMode(),
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
// What an item-removal confirm shows: the item's own current scalar
// values (truncated) — never any other description of the item.
function describeItemContent(item) {
  const parts = [];
  for (const k of Object.keys(item)) {
    const v = item[k];
    if (k === 'id' || (typeof v !== 'string' && typeof v !== 'number')) continue;
    const s = String(v);
    parts.push(`${k}: "${s.length > 80 ? s.slice(0, 77) + '…' : s}"`);
  }
  return parts.join(' · ');
}

function describeField(session, ref) {
  const res = describeFieldValue(session, ref);
  // Block-level visibility state rides along on every successful field
  // description, so the editor pane can offer the section's hide/show
  // toggle next to whichever field was clicked. Absent flag → no toggle.
  // The Task-4 affordances ride along the same way: which item
  // blueprints can add to this block ("Add <thing>…"), and — when the
  // click landed on an item — whether that item is removable.
  if (res.ok && ref && ref.block !== 'site') {
    const content = readCandidate(session);
    const fields = indexHosts(content).get(ref.block);
    if (fields && typeof fields.hidden === 'boolean') res.blockHidden = fields.hidden;

    // Focal point + zoom ride along on the background-image editor (the click
    // that opens "Replace image" is the click that opens the reposition/zoom
    // controls). Shared by every header-style block whose background carries the
    // seeded fields — the hero and the page-header alike; the gate is the
    // `background` field plus the fields' presence, never the block type. Absent
    // fields → no controls, the editor degrades to image-replace.
    if (fields && ref.field === 'background'
        && (typeof fields.bgPosition === 'string' || typeof fields.bgZoom === 'number')) {
      res.heroFocal = {
        position: typeof fields.bgPosition === 'string' ? fields.bgPosition : '50% 50%',
        zoom: typeof fields.bgZoom === 'number' ? fields.bgZoom : 1,
      };
    }

    let block = null;
    for (const p of content.pages || []) {
      for (const b of p.blocks || []) if (b && b.id === ref.block) block = b;
    }
    if (block) {
      const registry = scaffold.loadBlueprints();
      const addable = scaffold.itemBlueprintsFor(block.type, null, registry)
        .map(({ key, blueprint }) => ({ key, name: blueprint.name, purpose: blueprint.purpose }));
      if (addable.length) res.addable = addable;

      // A hero CTA button: the overlay click resolves to (block, item, label) —
      // the single annotated element on the <a> — but the editor also needs the
      // button's link and style. Read them off the item directly (the same
      // candidate content) and ride them along so the UI can open the button
      // editor; label, href, and style each save their own guarded set patch.
      // Mirrors heroFocal riding the hero image editor.
      if (block.type === 'hero' && ref.item != null && ref.item !== '' && ref.field === 'label') {
        const actions = (block.fields && Array.isArray(block.fields.actions)) ? block.fields.actions : [];
        const action = actions.find(a => a && a.id === ref.item);
        if (action && typeof action.href === 'string' && typeof action.style === 'string') {
          res.button = { href: action.href, style: action.style };
        }
      }
      if (ref.item != null && ref.item !== '') {
        const probe = scaffold.removeItem(JSON.parse(JSON.stringify(content)),
          { block: ref.block, item: ref.item }, registry);
        if (probe.ok) {
          const bp = scaffold.itemBlueprintsFor(block.type, probe.removed.field, registry)[0];
          res.itemRemove = { allowed: true, thing: bp ? bp.blueprint.name : 'item',
            summary: describeItemContent(probe.removed.item) };
        } else {
          res.itemRemove = { allowed: false, reason: probe.errors.join('\n') };
        }
      }
    }
  }
  return res;
}

// The site hero image (home-page hero background, else the first hero
// anywhere) — what a page-header that omits its own background inherits at
// render time. Mirrors findSiteHeroImage in build.js (that module is an entry
// script and can't be required without running a build).
function siteHeroImage(content) {
  const pages = (content && content.pages) || [];
  const heroBg = (page) => (page.blocks || [])
    .find(b => b && b.type === 'hero' && b.fields && b.fields.background);
  const index = pages.find(p => p.slug === 'index');
  const hit = (index && heroBg(index)) || pages.map(heroBg).find(Boolean);
  return hit ? hit.fields.background : null;
}

// The creatable-field descriptor for (block, field), or null. Shares patch.js's
// CREATABLE_FIELDS so the editor offers exactly what the write path will accept
// creating, and opens the right editor for the descriptor's `kind`.
function creatableDescriptor(content, blockId, field) {
  return creatableFieldsFor(blockTypeById(content, blockId)).find(c => c.field === field) || null;
}

function describeFieldValue(session, ref) {
  if (!ref || typeof ref.block !== 'string' || typeof ref.field !== 'string') {
    return { ok: false, error: 'a field reference needs at least "block" and "field"' };
  }
  const content = readCandidate(session);
  const r = resolveHost(content, ref.block, ref.item != null ? ref.item : null);
  if (r.error) return { ok: false, error: r.error };
  const f = readFieldValue(r.host, ref.field);
  if (!f.exists) {
    // An allowlisted creatable field is editable even though it's absent —
    // saving CREATES it (permitted by applyPatch's CREATABLE guard). The
    // editor opened depends on the descriptor's kind:
    //   image — an omitted page-header background, whose "current" value is the
    //     inherited site hero image;
    //   text  — an omitted subtitle, opened as an empty text field.
    const desc = (ref.index == null || ref.index === '') && (ref.item == null || ref.item === '')
      ? creatableDescriptor(content, ref.block, ref.field) : null;
    if (desc && desc.kind === 'image') {
      return { ok: true, kind: 'image', field: ref.field, value: siteHeroImage(content) || '', inherited: true };
    }
    if (desc && desc.kind === 'text') {
      return { ok: true, kind: 'text', field: ref.field, value: '', creating: true };
    }
    return { ok: false, error: `field "${ref.field}" does not exist on "${ref.block}"` };
  }
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
    const out = { ok: true, kind, field: ref.field, lines: v.slice() };
    // A soft, non-blocking heads-up once a gallery album holds a lot of photos:
    // the owner can keep adding (no cap), but a heavy album makes its page slower
    // to load. Computed here, beside the size cap, so the same advisory shows on
    // the Node editor and the browser demo (both read through this seam).
    if (kind === 'image-list' && v.length >= GALLERY_PHOTOS_HEAVY_AFTER) {
      out.notice = 'This album has a lot of photos now — more will make the gallery page slower to load. That’s fine, just something to keep in mind.';
    }
    return out;
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

/* Describe one SECTION's settings + addable fields — what the overlay's
   per-section chip opens in the Section panel. Read-only and derived from the
   same edit map every other surface is: the section-level concerns it reports
   (background, style/variant, visibility) and the optional fields it could ADD
   but omits (the descriptor's `creatable`) all route back through the existing
   /api/field + /api/edit path, so the panel adds no new write surface. */
function describeSection(session, ref) {
  if (!ref || typeof ref.block !== 'string') {
    return { ok: false, error: 'a section reference needs a "block" id' };
  }
  const content = readCandidate(session);
  const map = buildEditMap(content, session.host.presetTokens(content));
  let desc = null;
  for (const p of map.pages || []) {
    for (const b of p.blocks || []) if (b.id === ref.block) desc = b;
  }
  if (!desc) return { ok: false, error: `unknown section "${ref.block}"` };
  const fields = indexHosts(content).get(ref.block) || {};
  const hasVariant = desc.scalars.some(s => s.field === 'variant');
  // Item blueprints that can ADD a repeating item to this section type — the
  // doorway for "Add a button" when a hero's actions are empty (no button to
  // click). Editing/removing existing buttons already rides describeField →
  // appendItemControls; this is the empty-state entry the click can't reach.
  const addItems = scaffold.itemBlueprintsFor(desc.type, null, scaffold.loadBlueprints())
    .map(({ key, blueprint }) => ({ key, name: blueprint.name, purpose: blueprint.purpose }));
  return {
    ok: true,
    block: ref.block,
    type: desc.type,
    // background/variant report whether the section exposes that setting at all
    // (a scalar on the edit map); the panel routes each to its existing editor.
    background: desc.scalars.some(s => s.field === 'background'),
    variant: hasVariant ? { value: fields.variant != null ? String(fields.variant) : '' } : null,
    hidden: desc.hidden,          // null when the visibility flag isn't seeded
    addable: (desc.creatable || []).map(c => ({ field: c.field, kind: c.kind })),
    addItems,
  };
}

/* Run the token guards (format + contrast) against the CANDIDATE content
   without writing anything — the live feedback behind the color picker.
   The plain-language explanation IS the resolver's own error message. */
function checkToken(session, token, value) {
  const clone = readCandidate(session); // fresh parse — mutating it touches nothing
  const result = applyPatch(clone, { action: 'set-token', token: String(token), value: String(value) },
    session.host.presetTokens(clone));
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
  const inUse = name => session.host.candidateImageExists(name) || (taken && taken.has(name));
  let name = stem + ext;
  for (let n = 2; inUse(name); n++) name = `${stem}-${n}${ext}`;
  return { name, bytes };
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

  const beforeText = session.host.readCandidateText();
  const content = JSON.parse(beforeText);
  const presetTokens = session.host.presetTokens(content);

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

  if (staged) session.host.writeCandidateImage(staged.name, staged.bytes);
  session.host.writeCandidateText(JSON.stringify(content, null, 2) + '\n');

  const b = session.host.buildCandidate();
  if (!b.ok) {
    session.host.writeCandidateText(beforeText);
    if (staged) session.host.removeCandidateImage(staged.name);
    session.host.buildCandidate(); // restore the preview to the last good state
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
      target: blueprint.target || null,
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

  const beforeText = session.host.readCandidateText();
  const content = JSON.parse(beforeText);
  const inst = scaffold.instantiate(content, bp, req.variant, values,
    { targetSlug: req.targetPage, targetBlock: req.targetBlock });
  if (!inst.ok) return { ok: false, error: inst.errors.join('\n') };

  for (const s of staged) session.host.writeCandidateImage(s.name, s.bytes);
  session.host.writeCandidateText(JSON.stringify(content, null, 2) + '\n');

  const b = session.host.buildCandidate();
  if (!b.ok) {
    session.host.writeCandidateText(beforeText);
    for (const s of staged) session.host.removeCandidateImage(s.name);
    session.host.buildCandidate(); // restore the preview to the last good state
    return { ok: false, buildFailed: true, error: `That addition did not pass the site's checks, so it was not kept:\n${b.out}` };
  }

  const c = inst.created;
  session.pending = {
    patch: null,
    scaffold: { blueprint: entry.key, variant: req.variant },
    // The full request as resolved here (image paths already assigned), so
    // the staged-list replay can re-instantiate it deterministically.
    replayScaffold: { blueprint: entry.key, variant: req.variant, values,
      targetPage: req.targetPage, targetBlock: req.targetBlock },
    old: null,
    new: c.kind === 'page'
      ? `New page "${c.navLabel}" (${c.file}) with ${c.blockIds.length} section(s), added to the menu`
      : c.kind === 'item'
        ? `New ${bp.name.toLowerCase()} in the ${c.blockId} section (${c.file})`
        : `New section on ${c.file}`,
    summary: c.kind === 'page' ? `add page "${c.navLabel}" (${c.file})`
           : c.kind === 'item' ? `add a ${bp.name.toLowerCase()} to ${c.blockId}`
           : `add a section to ${c.slug}`,
    uploads: staged.map(s => s.name),
    uploadFiles: staged.map(s => ({ name: s.name, bytes: s.bytes })),
    at: new Date().toISOString(),
  };
  return { ok: true, pending: publicPending(session), created: c };
}

/* The structural counterpart of applyScaffold in the other direction:
   remove ONE repeating item from the CANDIDATE copy through
   scaffold.removeItem (its guards: only id-bearing item arrays, never
   the last item, only where a blessed item blueprint exists) → candidate
   rebuild as the acceptance gate → pending change card. Same
   one-pending-change rule, same rollback-on-failure, same
   keep/discard/publish flow afterwards. Never applyPatch. */
function applyRemoveItem(session, ref) {
  if (session.pending) {
    return { ok: false, error: 'There is already a pending change — keep or discard it first.' };
  }
  if (!ref || typeof ref !== 'object') return { ok: false, error: 'bad remove request' };

  const beforeText = session.host.readCandidateText();
  const content = JSON.parse(beforeText);
  const rm = scaffold.removeItem(content, { block: ref.block, item: ref.item });
  if (!rm.ok) return { ok: false, error: rm.errors.join('\n') };

  session.host.writeCandidateText(JSON.stringify(content, null, 2) + '\n');
  const b = session.host.buildCandidate();
  if (!b.ok) {
    session.host.writeCandidateText(beforeText);
    session.host.buildCandidate(); // restore the preview to the last good state
    return { ok: false, buildFailed: true, error: `That removal did not pass the site's checks, so it was not kept:\n${b.out}` };
  }

  session.pending = {
    patch: null,
    removeItem: { block: ref.block, item: ref.item },
    old: describeItemContent(rm.removed.item),
    new: null,
    summary: `remove an item from ${ref.block}`,
    uploads: [],
    uploadFiles: [],
    at: new Date().toISOString(),
  };
  return { ok: true, pending: publicPending(session), removed: rm.removed };
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
      : p.removeItem
        ? { kind: 'remove-item', ...p.removeItem }
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
  session.host.resetCandidateFromLive();
  const content = JSON.parse(session.host.readCandidateText());
  const presetTokens = session.host.presetTokens(content);
  for (const entry of session.staged) {
    if (entry.replay.kind === 'patch') {
      const r = applyPatch(content, { ...entry.replay.patch }, presetTokens);
      if (!r.ok) {
        return { ok: false, error: `replaying a kept change failed unexpectedly: ${r.error || r.reason}` };
      }
    } else if (entry.replay.kind === 'remove-item') {
      const rm = scaffold.removeItem(content, { block: entry.replay.block, item: entry.replay.item });
      if (!rm.ok) {
        return { ok: false, error: `replaying a kept removal failed unexpectedly:\n${rm.errors.join('\n')}` };
      }
    } else {
      const loaded = scaffold.loadBlueprints();
      const e = loaded.blueprints.find(b => b.key === entry.replay.blueprint);
      if (!e) return { ok: false, error: `replaying a kept addition failed: unknown blueprint "${entry.replay.blueprint}"` };
      const inst = scaffold.instantiate(content, e.blueprint, entry.replay.variant,
        entry.replay.values, { targetSlug: entry.replay.targetPage, targetBlock: entry.replay.targetBlock });
      if (!inst.ok) {
        return { ok: false, error: `replaying a kept addition failed unexpectedly:\n${inst.errors.join('\n')}` };
      }
    }
    for (const f of entry.uploadFiles) session.host.writeCandidateImage(f.name, f.bytes);
  }
  session.host.writeCandidateText(JSON.stringify(content, null, 2) + '\n');
  const b = session.host.buildCandidate();
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
  session.host.resetCandidateFromLive();
  const b = session.host.buildCandidate();
  if (!b.ok) return { ok: false, buildFailed: true, error: `candidate rebuild failed:\n${b.out}` };
  return { ok: true };
}

/* Publish: ship the whole staged session in one step. The session-state
   guards (no pending change; something staged) and the staged-list
   bookkeeping live here; the actual shipping — copy candidate content +
   uploaded images to live, rebuild live without annotations, run the publish
   command once, with rollback on a failing rebuild — is the host's
   shipSession(). For the Node host that writes clients/<client>/ and runs
   git/the custom command; for the demo host it is a no-op. The staged session
   is consumed (and lastPublish recorded) ONLY when the host actually wrote
   live (`result.live`), so a demo "publish" leaves the session intact. */
function publish(session) {
  if (session.pending) {
    return { ok: false, error: 'Keep or discard the pending change before publishing.' };
  }
  if (session.staged.length === 0) {
    return { ok: false, error: 'There is nothing to publish — keep at least one change first.' };
  }

  const uploads = [];
  for (const entry of session.staged) for (const name of entry.uploads) uploads.push(name);
  const summary = sessionSummary(session.staged);

  const result = session.host.shipSession({ uploads, summary });
  if (!result.ok) return result;     // build-failed (rolled back) or refused — session intact
  if (!result.live) return result;   // demo host: nothing shipped, staged session preserved
  session.staged = [];
  session.lastPublish = { at: new Date().toISOString(), ok: result.publish.ok, message: result.publish.message };
  return { ok: true, publish: result.publish };
}

/* Restore: revert the last publish (one publish = one commit = the whole
   session, so this reverts the whole session as one unit). The session-state
   guard lives here; the git-revert + rebuild + republish is the host's
   restore(). */
function restore(session) {
  if (session.pending || session.staged.length) {
    return { ok: false, error: 'Publish or discard your changes before restoring a previous version.' };
  }
  const result = session.host.restore();
  if (!result.ok) return result;
  session.lastPublish = { at: new Date().toISOString(), ok: result.publish.ok, message: result.publish.message };
  return { ok: true, publish: result.publish };
}

module.exports = {
  createSession, getState, describeField, describeSection, checkToken,
  // The maintenance-tier handlers are exported through the ledger
  // boundary: one JSONL line per attempt, whoever the caller is.
  applyEdit: logged('edit', applyEdit,
    (session, patch, upload) => (upload != null ? { patch, upload: describeUpload(upload) } : { patch })),
  applyScaffold: logged('scaffold', applyScaffold,
    (session, req) => describeScaffoldRequest(req)),
  applyRemoveItem: logged('remove-item', applyRemoveItem,
    (session, ref) => (ref && typeof ref === 'object' ? { block: ref.block, item: ref.item } : null)),
  listBlueprints,
  keep: logged('keep', keep, describePendingRequest),
  discard: logged('discard', discard, describePendingRequest),
  discardAll: logged('discard-all', discardAll, describeSessionRequest),
  publish: logged('publish', publish, describeSessionRequest),
  restore: logged('restore', restore, null),
  // Node convenience re-exports. loadConfig is lazily required so owner.js
  // carries no static dependency on the Node host (the browser bundle injects
  // its own host and never reaches these).
  loadConfig: (client) => require('./host-node').loadConfig(client),
  candDistDir: (session) => session.host.candDistDir(),
  candContentPath: (session) => session.host.candContentPath(),
  liveContentPath: (session) => session.host.liveContentPath(),
  SAFE_TOKENS,
};
