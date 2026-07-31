/* ============================================================
   engine/lib/patch.js — Canonical patch resolver & write allowlist

   The single source of truth for how a maintenance-tier patch is
   applied to a content.json object. Both the production apply tool
   and the test harness import this, so they can never diverge.

   PATCH SHAPES (what a local model emits):

     Set a field on a block:
       { "action":"set", "block":"home-hero", "field":"headline", "value":"..." }

     Set a field on a repeating item, addressed by ITS id (never by index):
       { "action":"set", "block":"home-testimonials", "item":"testi-jane",
         "field":"attribution", "value":"..." }

     Set one line in a flat text list by matching its current text:
       { "action":"set", "block":"home-hours", "field":"items",
         "match":"Office: Tuesdays 6-8pm", "value":"Office: Wednesdays 6-8pm" }

     Append a string to a flat string list (e.g. a photo path to a gallery album):
       { "action":"append", "block":"gallery-main", "item":"album-deck",
         "field":"images", "value":"img/deck-3.jpg" }
     NOTE: append is only permitted on flat string lists. Object-item arrays
     (cards, quotes, albums, plans, members, …) are structural — append is
     refused at the resolver level. Adding or removing an item is
     developer-managed.

     Delete one line from a flat text list by matching its current text:
       { "action":"delete", "block":"home-hours", "field":"items",
         "match":"Office: Tuesdays 6-8pm" }
     NOTE: delete is only permitted on flat string lists (list-panel items,
     image filenames inside albums). It is explicitly refused on object-item
     arrays — structural removal is developer-managed.

     Set a SAFE theme token (the only appearance edit the maintenance
     tier may ever perform — see SAFE_TOKENS below):
       { "action":"set-token", "token":"--color-primary", "value":"#2D6A4F" }
     On success this writes site.themeOverrides[<token>] — the ONLY write
     path into themeOverrides. Plain "set" patches that target
     themeOverrides (the container OR any key inside it via a dotted
     path) are rejected here, so the format guards cannot be bypassed.

     Refuse an out-of-scope request:
       { "action":"refuse", "reason":"..." }

   `block` is a block id, or the literal "site" for site-wide fields
   (e.g. {block:"site", field:"contact.phone"}). No page/block array
   indices ever appear in a patch — addressing is by identity only.

   SAFETY (write allowlist, enforced here, not by trusting the model):
     - `id`, `type`, and `slug` are never writable.
     - You cannot replace a whole object/array container with `set`
       (no swapping out an entire `cards` array, `fields` object, etc.).
     - The target must already exist; nothing new is created except
       `append` adding one element to an existing list, and `set-token`
       creating/updating one allowlisted key in site.themeOverrides.
     - `set-token` values pass a strict per-type format guard (whitelist
       regexes) plus an injection blacklist — a value can never carry
       CSS that escapes the custom-property declaration.
   A patch that violates any of these returns { ok:false, error } and
   mutates nothing.
   ============================================================ */

'use strict';

const FORBIDDEN_KEYS = new Set(['id', 'type', 'slug']);

// In-site image path shape (mirrors scaffold.js IMG_RE; kept local so this
// canonical guard module stays dependency-free).
const IMAGE_PATH_RE = /^img\/[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|avif|svg)$/i;

// One-line text guard for a creatable text field (e.g. a subtitle): up to
// 200 chars, no control characters or line breaks. The value is escaped at
// render exactly like an existing subhead, so this is the privileged-create
// gate (creation is the one act the resolver normally refuses), not a render
// safety net. \x00-\x1F and \x7F are the C0/C1-adjacent control range.
const TEXT_LINE_RE = /^[^\x00-\x1F\x7F]{1,200}$/;

// Star-rating and review-count shapes, shared by BOTH gates that touch them:
// the CREATABLE descriptor below (may this field be brought into existence?)
// and the FIELD_FORMATS guard further down (may this value be written at all?).
// One regex per concept, read twice, so the create path and the overwrite path
// can never disagree about what a rating is. A rating is the 0–5 star figure the
// badge prints beside a ★ glyph; a count is a plain integer, optionally
// comma-grouped the way a listing displays it ("1,204").
const RATING_RE       = /^[0-5](?:\.\d)?$/;
const REVIEW_COUNT_RE = /^(?:\d{1,7}|\d{1,3}(?:,\d{3})+)$/;

// CREATABLE FIELDS — the single, narrow exception to "the resolver never
// creates a field." Keyed by block TYPE → field → a DESCRIPTOR
// { kind, guard, whenAbsent, hint? }. A plain `set` may bring one of these into
// existence on a block that omits it, but ONLY with a value the `guard`
// (a RegExp) accepts; everything else still requires the field to pre-exist.
//   kind:       'image' | 'text' — which editor the field opens / how the
//               edit map surfaces it.
//   whenAbsent: 'inherits' — a rendered element exists even when the value is
//               omitted (the page-header background inherits the site hero and
//               always paints a bg div), so the field stays click-reachable as
//               an ordinary scalar; vs
//               'omitted' — no element renders when the value is absent (a
//               subhead), so the field is unreachable by clicking and is
//               surfaced as a "creatable" doorway instead.
//   hint:       the plain-language reason a value was refused. Without one, a
//               guard failure reports "field does not exist", which is true of
//               the field but says nothing about the value the owner typed —
//               fine when rejection is near-impossible (any one-line string
//               clears TEXT_LINE_RE), misleading for a shaped value like a
//               rating, where rejection is the ordinary case.
// The guard means creation can never smuggle in arbitrary content, and the
// editable surface is still developer-defined (this allowlist), not
// owner-expandable. Only genuinely OPTIONAL fields belong here: a hero subhead
// is schema-REQUIRED (heroFields in content.schema.json), so a hero always has
// one and it is already click-editable — it is not creatable. A page-header
// subhead IS optional (pageHeaderFields requires only tag + heading), so an
// interior header that omits its subtitle can have one added from the editor.
// A reviews-link's rating / reviewCount / label are the other natural members:
// the block is BUILT to degrade as each goes absent (see its header comment), so
// an owner who has a stale review count taken out would otherwise lose the
// ability to put one back — a one-way door that turns an ordinary "drop the
// number" request into a developer errand. All three render nothing when they
// are absent, hence 'omitted'. `label` overrides the composed badge text
// outright, which is why its hint says so: adding one is how an owner replaces
// "★ 5.0 · 11 reviews on Google" wholesale, and the preview shows the effect
// before anything is kept.
const CREATABLE_FIELDS = {
  'page-header':  { background: { kind: 'image', guard: IMAGE_PATH_RE,  whenAbsent: 'inherits' },
                    subhead:    { kind: 'text',  guard: TEXT_LINE_RE,   whenAbsent: 'omitted'  } },
  'reviews-link': { rating:      { kind: 'text', guard: RATING_RE,       whenAbsent: 'omitted',
                      hint: 'a rating is a number from 0 to 5, with at most one decimal — like "4.9"' },
                    reviewCount: { kind: 'text', guard: REVIEW_COUNT_RE, whenAbsent: 'omitted',
                      hint: 'a review count is a whole number — like "11" or "1,204"' },
                    label:       { kind: 'text', guard: TEXT_LINE_RE,    whenAbsent: 'omitted',
                      hint: 'a badge label is a single line of text, up to 200 characters; it replaces the rating and review count in the badge' } },
};

// The creatable-field descriptors for a block TYPE, as a flat list — the one
// source the edit map and owner handlers read so the editor offers exactly
// what the write path will accept creating.
function creatableFieldsFor(blockType) {
  const guard = CREATABLE_FIELDS[blockType] || {};
  return Object.keys(guard).map(field => ({ field, ...guard[field] }));
}

function blockTypeById(content, id) {
  for (const page of (content && content.pages) || []) {
    for (const block of (page && page.blocks) || []) {
      if (block && block.id === id) return block.type;
    }
  }
  return null;
}

// May a plain `set` CREATE this (block, field) with this value? Only for a
// top-level block field (never an item field) whose (type, field) is in the
// allowlist and whose value clears the descriptor's guard.
// Reports the two failures separately, because they are different answers to
// the owner: `creatable:false` means this field is not one the resolver may ever
// invent (fall through to the ordinary "does not exist" refusal), while
// creatable-but-not-ok means the field WAS offered and the value was wrong —
// the case that earns the descriptor's plain-language hint.
function creatableCheck(content, blockId, item, key, value) {
  if (item != null) return { creatable: false };
  const guard = CREATABLE_FIELDS[blockTypeById(content, blockId)];
  const desc = guard && guard[key];
  if (!desc) return { creatable: false };
  if (typeof value === 'string' && desc.guard.test(value)) return { creatable: true, ok: true };
  return { creatable: true, ok: false,
    error: desc.hint || `"${value}" is not an accepted value for "${key}"` };
}

/* ── Developer-only fields ───────────────────────────────────
   Block fields that are rendered markup CONFIGURATION rather than owner
   content. They need a developer-set value, but an owner changing one breaks
   something they cannot see in the preview and could not diagnose afterwards —
   so they are refused here AND omitted from the edit map
   (engine/lib/sitemap.js reads this same table), which together mean no
   annotation is emitted, the editor never opens one, and the maintenance model
   is never shown that the field exists. Keyed by block TYPE → field names, on
   the leaf name so a dotted path cannot slip past.

   The honeypot in engine/blocks/contact-form.js is the same idea taken further
   (fixed value, no schema surface at all); this table is for the ones that need
   a per-site value. Today: a contact-form's `source` tag. Two forms sharing one
   inbox tell themselves apart by it, which is how ad spend gets attributed —
   retarget it silently and a working form looks exactly like a dead one.

   A developer edits these in content.json, where the change is reviewable in a
   diff; that is the tier they belong to. */
const DEVELOPER_ONLY_FIELDS = {
  'contact-form': new Set(['source']),
  // hero-form keeps its form spec one level down (`form.source`), which is why
  // the match below is on the LEAF name — the field is the same field wherever
  // the block chooses to put it.
  'hero-form':    new Set(['source']),
  // Two gallery fields, both wiring rather than content.
  //
  // `value` is the JOIN KEY between a filter and its albums (an album belongs
  // to the category whose `value` its `category` equals), and since gallery
  // filters became addressable items it is the one field on them an owner must
  // never reach: renaming "garages" orphans every album in the category at
  // once, and the preview shows a tab that has simply gone empty with nothing
  // to suggest why. The visible half — `label` — stays editable, so renaming
  // the TAB is still a one-click edit; only the identity underneath is
  // developer surface.
  //
  // `allShows` switches what the "All" tab is (every album, or one cover per
  // category). It renders no element of its own, it re-plumbs the first thing
  // every visitor sees, and flipping it to "categories" can make an album with
  // an unmatched category reachable from no view at all — a break that is
  // invisible in the preview and undiagnosable afterwards, which is this
  // table's entire remit. It is a developer edit in content.json, where the
  // build advisories fire and the diff is reviewable.
  //
  // Matching is on the LEAF name; neither `filters` nor `albums` carries
  // another `value` or `allShows` leaf, so this costs the block nothing.
  'gallery':      new Set(['value', 'allShows']),
};

// The developer-only field names for a block TYPE, as a Set — the one source
// the edit map reads, so the two gates can never drift apart.
function developerOnlyFieldsFor(blockType) {
  return DEVELOPER_ONLY_FIELDS[blockType] || new Set();
}

function isDeveloperOnlyField(blockType, field) {
  return developerOnlyFieldsFor(blockType).has(String(field).split('.').pop());
}

/* ── SAFE TOKENS ─────────────────────────────────────────────
   The curated allowlist of theme tokens the maintenance tier may edit.
   Keys are canonical token names WITHOUT the leading "--" — matching the
   keys used in themes/<name>/tokens.json and site.themeOverrides (the
   build prefixes "--" when it injects the :root block).

   Inclusion criterion (deliberately conservative — when in doubt, OUT):
   a wrong VALUE may look ugly, but it can never break layout, overlap
   text, collapse a grid, or hide content. That limits the list to pure
   brand-identity paint: colors and the hero overlay strength.

   Deliberately EXCLUDED (structural — wrong values break layout):
   font families/sizes, spacing scale, radius, grid columns, z-indices,
   googleFontsUrl, cssBase, and EVERY text color (nav-text, footer-text,
   btn-primary-text, color-text/muted) plus the page backgrounds they
   pair with (color-bg/surface). Pair-exclusion rule: the model may only
   ever change ONE side of any contrast pair — the background/brand
   side — while the text side stays theme-controlled, and the contrast
   guard below mechanically rejects a background value that would
   collide with its theme-controlled counterpart. (v3: btn-primary-text
   was removed from this list after live-model testing showed small
   models reach for it on "change the text color" requests.) */
const SAFE_TOKENS = {
  'color-primary':        'color',   // brand color: accents, links, highlights
  'color-accent':         'color',   // secondary accent color
  'btn-primary-bg':       'color',   // primary button fill
  'nav-bg':               'color',   // top navigation background
  'footer-bg':            'color',   // footer background
  'hero-overlay-opacity': 'opacity', // dark overlay over hero/page-header photos
};

/* ── Contrast guard ──────────────────────────────────────────
   Each editable background token is paired with the theme-controlled
   color that renders on top of it. A set-token whose value lands too
   close to its counterpart's EFFECTIVE value (preset ⊕ overrides) is
   rejected — "make the button white" can never produce white-on-white.
   MIN_CONTRAST is deliberately low (1.5): the guard exists to catch
   collisions, not to police taste — legitimate low-contrast brand
   palettes (gold on cream ≈ 1.7–2.3) must still pass. */
const TOKEN_PAIRS = {
  'btn-primary-bg': ['btn-primary-text'],
  'nav-bg':         ['nav-text'],
  'footer-bg':      ['footer-text'],
  'color-primary':  ['color-bg'],
  'color-accent':   ['color-bg'],
};
const MIN_CONTRAST = 1.5;

// Small named-color table: enough to contrast-check the names owners
// actually use. Unknown names skip the guard (format guard already passed).
const NAMED_COLORS = {
  white:[255,255,255], black:[0,0,0], red:[255,0,0], green:[0,128,0],
  blue:[0,0,255], yellow:[255,255,0], orange:[255,165,0], purple:[128,0,128],
  pink:[255,192,203], gray:[128,128,128], grey:[128,128,128], silver:[192,192,192],
  gold:[255,215,0], navy:[0,0,128], teal:[0,128,128], maroon:[128,0,0],
  olive:[128,128,0], lime:[0,255,0], aqua:[0,255,255], cyan:[0,255,255],
  magenta:[255,0,255], fuchsia:[255,0,255], brown:[165,42,42], beige:[245,245,220],
  ivory:[255,255,240], tan:[210,180,140], salmon:[250,128,114], coral:[255,127,80],
  turquoise:[64,224,208], indigo:[75,0,130], violet:[238,130,238], khaki:[240,230,140],
  crimson:[220,20,60], chocolate:[210,105,30], lavender:[230,230,250], cream:[255,253,208],
};

// Parse a CSS color value to [r,g,b] (0–255), or null if unparseable.
function parseCssColor(raw) {
  const v = String(raw).trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split('').map(c => parseInt(c + c, 16));
  m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = v.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map(n => Math.min(255, n));
  m = v.match(/^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  return null;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(x => Math.round(x * 255));
}

// WCAG relative luminance + contrast ratio.
function contrastRatio(rgbA, rgbB) {
  const lum = rgb => {
    const [r, g, b] = rgb.map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(rgbA), lum(rgbB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// Hard blacklist of anything that could escape a CSS custom-property value.
const DANGEROUS_VALUE = /[;{}<>\\@]|url\s*\(|\/\*|expression|javascript:/i;

function normalizeTokenName(token) {
  return String(token).trim().replace(/^--/, '');
}

/* Per-type whitelist format guards. Everything not matched is rejected. */
function validateTokenValue(type, raw) {
  const v = String(raw).trim();
  if (!v || v.length > 64 || DANGEROUS_VALUE.test(v)) {
    return { ok: false, error: 'value failed the safety guard (unsafe characters or too long)' };
  }
  if (type === 'color') {
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return { ok: true };
    if (/^[a-z]+$/i.test(v)) return { ok: true }; // CSS named colors; an unknown name degrades to the stylesheet fallback, never to broken layout
    if (/^(?:rgb|rgba|hsl|hsla)\(\s*[\d.\s,%/]+\s*\)$/i.test(v)) return { ok: true };
    return { ok: false, error: `"${v}" is not a recognised color — use #rrggbb, a color name, rgb(), or hsl()` };
  }
  if (type === 'opacity') {
    if (/^(?:0|1|0?\.\d{1,4})$/.test(v)) return { ok: true };
    const m = v.match(/^(\d{1,3})%$/);
    if (m && Number(m[1]) <= 100) return { ok: true };
    return { ok: false, error: `"${v}" is not a valid opacity — use a number from 0 to 1, or 0–100%` };
  }
  return { ok: false, error: `unknown token type "${type}"` };
}

/* ── Guarded scalar fields ───────────────────────────────────
   A small allowlist of ordinary block fields whose VALUE space is
   constrained (mirroring validateTokenValue for tokens): a plain "set"
   may reach them, but only with a value that passes the per-type format
   guard below. Like the token guards, this keeps the maintenance tier's
   power to bounded values — a wrong value is ugly, never broken, and no
   raw CSS can pass. Keyed by the field's LEAF name (the last dotted
   segment), so the guard fires wherever such a field lives.

   Today: the hero background's owner-editable focal point + zoom
   (engine/blocks/hero.js paints these as inline background-position /
   transform:scale on .hero-bg), and a reviews-link's rating + review count.

   The rating/count pair is here as well as in CREATABLE_FIELDS on purpose. A
   creatable field can be cleared back to "" (the documented way to drop an
   optional value — the render omits an empty field), and a cleared field still
   EXISTS, so re-filling it takes the overwrite path, not the create path.
   Guarding only creation would mean a rating typed once was shaped and the same
   rating typed again was not; guarding both means the field holds a rating or
   nothing, however the owner got there. Both validators accept "" for exactly
   that reason — clearing is a removal, not a malformed value. */
const FIELD_FORMATS = {
  bgPosition:  'position',  // two percentages, each 0–100 (focal point)
  bgZoom:      'zoom',      // a bounded number, 1–3
  rating:      'rating',    // 0–5, at most one decimal, or "" to remove
  reviewCount: 'count',     // a whole number, optionally comma-grouped, or "" to remove
};

/* Per-type whitelist format guards for FIELD_FORMATS scalars. Everything
   not matched is rejected; no raw CSS can pass. */
function validateFieldValue(type, raw) {
  if (type === 'position') {
    const v = String(raw).trim();
    const m = v.match(/^(\d{1,3})%\s+(\d{1,3})%$/);
    if (m && Number(m[1]) <= 100 && Number(m[2]) <= 100) return { ok: true, value: v };
    return { ok: false, error: `"${v}" is not a valid focal point — use two percentages from 0–100, e.g. "50% 50%"` };
  }
  if (type === 'zoom') {
    // Always store the NUMBER, whichever type the caller sent — a number
    // field that ends up holding a string would fail the build-time schema.
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (Number.isFinite(n) && n >= 1 && n <= 3) return { ok: true, value: n };
    return { ok: false, error: `"${raw}" is not a valid zoom — use a number from 1 to 3` };
  }
  // rating/count pass the ORIGINAL value through rather than the trimmed string:
  // reviewCount is schema-typed string OR number, and a client holding a number
  // must keep holding one (owner.js re-coerces a numeric string before it gets
  // here). Only the shape is checked; the stored type is left alone.
  if (type === 'rating') {
    const v = String(raw).trim();
    if (v === '' || RATING_RE.test(v)) return { ok: true, value: raw };
    return { ok: false, error: `"${v}" is not a valid rating — use a number from 0 to 5, with at most one decimal, or clear it to remove the rating` };
  }
  if (type === 'count') {
    const v = String(raw).trim();
    if (v === '' || REVIEW_COUNT_RE.test(v)) return { ok: true, value: raw };
    return { ok: false, error: `"${v}" is not a valid review count — use a whole number like "11" or "1,204", or clear it to remove the count` };
  }
  return { ok: false, error: `unknown field type "${type}"` };
}

/* Apply a set-token patch: the only sanctioned write path into
   site.themeOverrides. Creating the themeOverrides object itself is the
   one object-creation this resolver permits (analogous to append).
   `presetTokens` (the theme's tokens.json object) is optional; when
   provided, the contrast guard checks the new value against the
   EFFECTIVE value of each paired token. Without it the guard still
   checks against any client overrides (defense in depth, not the sole
   gate — the allowlist and format guards always run). */
function applyTokenPatch(content, patch, presetTokens) {
  if (typeof patch.token !== 'string') return { ok: false, error: 'set-token requires a "token" name' };
  if (typeof patch.value !== 'string') return { ok: false, error: 'set-token requires a string "value"' };
  const name = normalizeTokenName(patch.token);
  if (!Object.prototype.hasOwnProperty.call(SAFE_TOKENS, name)) {
    return { ok: false, error: `token "--${name}" is not in the safe-token allowlist` };
  }
  const guard = validateTokenValue(SAFE_TOKENS[name], patch.value);
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!content || !content.site || typeof content.site !== 'object') {
    return { ok: false, error: 'content has no site object' };
  }

  // Contrast guard: never let an editable background collide with the
  // theme-controlled color that renders on top of it.
  if (SAFE_TOKENS[name] === 'color' && TOKEN_PAIRS[name]) {
    const newRgb = parseCssColor(patch.value);
    if (newRgb) {
      const overrides = content.site.themeOverrides || {};
      for (const counterpart of TOKEN_PAIRS[name]) {
        const effective = overrides[counterpart] != null ? overrides[counterpart]
          : (presetTokens && presetTokens[counterpart] != null ? presetTokens[counterpart] : null);
        if (effective == null) continue;
        const pairRgb = parseCssColor(effective);
        if (!pairRgb) continue;
        if (contrastRatio(newRgb, pairRgb) < MIN_CONTRAST) {
          return { ok: false, error: `"${String(patch.value).trim()}" is too close to the theme's --${counterpart} (${effective}) — the result would be unreadable. Pick a color with more contrast.` };
        }
      }
    }
  }

  if (!content.site.themeOverrides || typeof content.site.themeOverrides !== 'object') {
    content.site.themeOverrides = {};
  }
  content.site.themeOverrides[name] = String(patch.value).trim();
  return { ok: true, action: 'set-token', token: '--' + name };
}

// Map every addressable host: "site" -> site object; each block id -> its fields.
function indexHosts(content) {
  const map = new Map();
  if (content && content.site) map.set('site', content.site);
  for (const page of (content && content.pages) || []) {
    for (const block of (page && page.blocks) || []) {
      if (block && typeof block.id === 'string') map.set(block.id, block.fields || {});
    }
  }
  return map;
}

// Find a repeating sub-object with a matching id anywhere inside `node`.
function findItemById(node, id) {
  if (Array.isArray(node)) {
    for (const el of node) { const r = findItemById(el, id); if (r) return r; }
  } else if (node && typeof node === 'object') {
    if (node.id === id) return node;
    for (const k of Object.keys(node)) { const r = findItemById(node[k], id); if (r) return r; }
  }
  return null;
}

// Resolve a (possibly dotted) field name within a host to { parent, key }.
function resolveField(host, field) {
  const parts = String(field).split('.');
  let cur = host;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (cur == null || !(k in cur)) return null;
    cur = cur[k];
  }
  const lastRaw = parts[parts.length - 1];
  const key = /^\d+$/.test(lastRaw) ? Number(lastRaw) : lastRaw;
  return { parent: cur, key };
}

function fieldIsForbidden(field) {
  return FORBIDDEN_KEYS.has(String(field).split('.').pop());
}

/**
 * Apply a patch to a parsed content object (mutates it on success).
 * Returns { ok, action } on success, { ok:false, error } on failure,
 * or { ok:false, refused:true, reason } when the model declined.
 * `presetTokens` is optional (additive v3 parameter): the theme's
 * tokens.json object, used only by the set-token contrast guard.
 */
function applyPatch(content, patch, presetTokens) {
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'patch is not an object' };
  if (patch.action === 'refuse') return { ok: false, refused: true, reason: patch.reason || '' };
  if (patch.action === 'set-token') return applyTokenPatch(content, patch, presetTokens);
  if (patch.action !== 'set' && patch.action !== 'append' && patch.action !== 'delete') {
    return { ok: false, error: `unknown action "${patch.action}"` };
  }
  if (typeof patch.block !== 'string') return { ok: false, error: 'patch missing "block"' };
  if (typeof patch.field !== 'string') return { ok: false, error: 'patch missing "field"' };
  // Value-type guard. Booleans are accepted ADDITIVELY (v4.2, Task 1) and
  // only land where the existing value is already a boolean (enforced in the
  // set branch below) — since this resolver can never CREATE a field, the
  // boolean-writable surface is exactly the boolean fields a developer
  // seeded (today: the per-block "hidden" visibility flag).
  if (patch.action !== 'delete'
      && typeof patch.value !== 'string' && typeof patch.value !== 'number'
      && typeof patch.value !== 'boolean') {
    return { ok: false, error: `"${patch.field}" requires a string "value" (got ${patch.value === undefined ? 'no value' : typeof patch.value})` };
  }
  if (fieldIsForbidden(patch.field)) {
    return { ok: false, error: `field "${patch.field}" is structural and not editable` };
  }
  // themeOverrides is reachable ONLY via set-token (which carries the format
  // guards). Block both the container and dotted paths into it, so a plain
  // "set" can never smuggle an unguarded value into the injected :root block.
  if (patch.block === 'site' && /^themeOverrides(\.|$)/.test(patch.field)) {
    return { ok: false, error: 'theme tokens are edited with action "set-token", not "set"' };
  }
  // Rendered markup configuration is refused outright, for every action — the
  // write half of DEVELOPER_ONLY_FIELDS (the edit map omits the same fields, so
  // nothing should ever address one; this is what makes that a guarantee rather
  // than an omission). "site" carries no block type and is unaffected.
  const patchBlockType = blockTypeById(content, patch.block);
  if (patchBlockType && isDeveloperOnlyField(patchBlockType, patch.field)) {
    return { ok: false, error: `"${patch.field}" is part of how this site is wired up, not content — a developer changes it in content.json` };
  }

  // Resolve the host (a block's fields, the site object, or a sub-item by id).
  const hosts = indexHosts(content);
  if (!hosts.has(patch.block)) return { ok: false, error: `unknown block id: "${patch.block}"` };
  let host = hosts.get(patch.block);
  if (patch.item != null) {
    const item = findItemById(host, patch.item);
    if (!item) return { ok: false, error: `unknown item id "${patch.item}" in block "${patch.block}"` };
    host = item;
  }

  // Flat-text-list edit by matching the current line (no indices).
  if (patch.action === 'set' && typeof patch.match === 'string') {
    if (typeof patch.value === 'boolean') {
      return { ok: false, error: `"${patch.field}" is a text list — true/false values do not belong in it` };
    }
    const fr = resolveField(host, patch.field);
    if (!fr || !Array.isArray(fr.parent && fr.parent[fr.key])) {
      return { ok: false, error: `match requires "${patch.field}" to be a list` };
    }
    const arr = fr.parent[fr.key];
    const idx = arr.indexOf(patch.match);
    if (idx === -1) return { ok: false, error: `no list item equal to match "${patch.match}"` };
    arr[idx] = patch.value;
    return { ok: true, action: 'set' };
  }

  // Flat-text-list delete by matching the current line.
  // Only permitted on string arrays; object-item arrays (cards, quotes, albums)
  // are structural and must be managed by a developer, not the maintenance model.
  if (patch.action === 'delete') {
    if (typeof patch.match !== 'string') {
      return { ok: false, error: 'delete requires a "match" string to identify the line' };
    }
    const fr = resolveField(host, patch.field);
    if (!fr) return { ok: false, error: `field path does not exist: ${patch.field}` };
    const arr = fr.parent[fr.key];
    if (!Array.isArray(arr)) {
      return { ok: false, error: `delete target is not a list: ${patch.field}` };
    }
    if (arr.some(el => el !== null && typeof el === 'object')) {
      return { ok: false, error: `"${patch.field}" contains objects; only flat string lists support delete` };
    }
    const idx = arr.indexOf(patch.match);
    if (idx === -1) return { ok: false, error: `no list item equal to match "${patch.match}"` };
    arr.splice(idx, 1);
    return { ok: true, action: 'delete' };
  }

  const fr = resolveField(host, patch.field);
  if (!fr) return { ok: false, error: `field path does not exist: ${patch.field}` };
  const { parent, key } = fr;

  if (patch.action === 'set') {
    if (parent == null || !(key in parent)) {
      // A missing field is an error EXCEPT for an allowlisted creatable field
      // set to a guard-passing value (e.g. a page-header background image).
      // A creatable field whose VALUE was refused reports why, so "4.85" gets
      // told it is a rating problem rather than a field-does-not-exist one.
      if (parent != null) {
        const c = creatableCheck(content, patch.block, patch.item, String(key), patch.value);
        if (c.creatable) {
          if (!c.ok) return { ok: false, error: c.error };
          parent[key] = patch.value;
          return { ok: true, action: 'set', created: true };
        }
      }
      return { ok: false, error: `field does not exist: ${patch.field}` };
    }
    if (FORBIDDEN_KEYS.has(String(key))) return { ok: false, error: `"${key}" is not editable` };
    const existing = parent[key];
    if (existing !== null && typeof existing === 'object') {
      return { ok: false, error: `"${patch.field}" is a container; only its inner values are editable` };
    }
    // Boolean writes are type-preserving in BOTH directions: a boolean can
    // only replace a boolean, and a boolean field accepts only booleans.
    // true/false therefore stays a closed two-value domain by construction.
    if (typeof patch.value === 'boolean' && typeof existing !== 'boolean') {
      return { ok: false, error: `"${patch.field}" does not hold true/false — a boolean value is only accepted where the field already holds one` };
    }
    if (typeof existing === 'boolean' && typeof patch.value !== 'boolean') {
      return { ok: false, error: `"${patch.field}" holds true/false — set it with a boolean value, not ${typeof patch.value === 'string' ? `"${patch.value}"` : patch.value}` };
    }
    // Value-constrained scalars (focal point, zoom): a plain set reaches
    // them, but only with a value the per-field format guard accepts.
    const fmt = FIELD_FORMATS[String(key)];
    if (fmt) {
      const guard = validateFieldValue(fmt, patch.value);
      if (!guard.ok) return { ok: false, error: guard.error };
      parent[key] = guard.value;   // normalized (e.g. zoom stored as a number)
      return { ok: true, action: 'set' };
    }
    parent[key] = patch.value;
    return { ok: true, action: 'set' };
  }

  // append — only permitted on flat string lists (image paths, text list items).
  // Object-item arrays (cards, quotes, albums) are structural; adding/removing an item
  // is developer-managed. Mirrors the same restriction already enforced on delete.
  const target = parent[key];
  if (typeof patch.value === 'boolean') {
    return { ok: false, error: `"${patch.field}" is a list — true/false values do not belong in it` };
  }
  if (!Array.isArray(target)) return { ok: false, error: `append target is not a list: ${patch.field}` };
  if (target.some(el => el !== null && typeof el === 'object')) {
    return { ok: false, error: `"${patch.field}" contains objects; append is not permitted on structured item arrays — use set to edit existing items by id` };
  }
  target.push(patch.value);
  return { ok: true, action: 'append' };
}

module.exports = {
  applyPatch, indexHosts, findItemById, blockTypeById, CREATABLE_FIELDS, creatableFieldsFor,
  DEVELOPER_ONLY_FIELDS, developerOnlyFieldsFor, isDeveloperOnlyField,
  SAFE_TOKENS, validateTokenValue, normalizeTokenName,
  FIELD_FORMATS, validateFieldValue,
  TOKEN_PAIRS, MIN_CONTRAST, parseCssColor, contrastRatio,
  // Exported (additive) so the theme validator applies the SAME injection
  // blacklist to preset token values that set-token applies to owner values.
  DANGEROUS_VALUE,
};
