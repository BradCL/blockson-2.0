# Static Site Engine — Build Specification (v4)

This document is the authoritative spec for a reusable static-site engine. Implement it
exactly as written. Do not introduce frameworks, alternative architectures, or naming
conventions not described here. Where this spec is silent, prefer the simplest option
consistent with the principles below.

v2 additions over the original spec: §9 (token-level editing via the maintenance tier),
the v2 block set in BLOCK_CATALOG.md, and the theme-preset system in themes/README.md.

v4: the local model is removed from the runtime entirely. All editing is deterministic
(click-to-edit UI + blueprint instantiation). The patch pipeline (`applyPatch`) is
the permanent seam; see §11 for the optional-model attachment point.

---

## 1. Purpose

This engine generates static marketing websites for small local businesses from a single
data file per client. One engine, many clients. A client site is fully described by one
`content.json` file plus a folder of images. Changing the data file changes the site;
the engine code never changes per client.

The engine exists to support a two-tier maintenance model:

- **Setup tier** (a developer, using full tooling): defines clients, assembles pages from
  blocks, can edit anything.
- **Maintenance tier** (owner, via click-to-edit UI or direct patch CLI): edits *only
  existing values* inside `content.json`, plus the curated safe-token allowlist (§9).
  It never adds, removes, or reorders blocks, and never touches engine code, CSS, JS,
  or the build script.

Every write, regardless of origin, passes through `applyPatch` and a candidate build
before touching the live site. The owner sees a preview and issues an explicit Approve.

---

## 2. Core Principles

1. **Data/template separation is absolute.** All client-specific content lives in
   `content.json`. All structure lives in block templates. All styling lives in the theme
   tokens + shared CSS. These never mix.
2. **No build-time intelligence required for maintenance.** Editing content is editing
   JSON values. Any system that can produce the patch shapes in §8.1 can maintain any
   site.
3. **The schema is the contract.** The build must validate `content.json` against the
   schema and fail loudly (with a clear message naming the offending block and field) if
   it is malformed. A safe failure is better than a broken deploy.
4. **One shared stylesheet, themed by tokens.** Block templates emit HTML using the
   stylesheet's class names; every color, font, and radius resolves through a CSS custom
   property injected from the theme's `tokens.json` merged with `site.themeOverrides`.
5. **Static output, zero runtime dependencies.** The build emits plain HTML/CSS/JS to
   `dist/`. The deployed site has no server, no database, no client-side fetching of
   content, no tracking. SEO-complete (canonical tags, meta, sitemap, OG tags).
6. **Extend by addition.** New capabilities arrive as new block types added to the
   registry. Adding a block must never require changing existing blocks or existing
   client content files.

---

## 3. Directory Structure

```
engine/
  build.js              Build script (Node, no external deps beyond a JSON schema validator)
  apply-patch.js        Patch CLI (content + token patches)
  serve.js              Owner-editor server (localhost; HTTP plumbing over lib/owner.js)
  sitemap.js            Edit-map inspection CLI
  new-client.js         Client scaffolder
  _run-proofs.js        Proof suite (8 proofs)
  ui/                   Owner editor app: index.html + ui.js + ui.css, and overlay.js
                        (injected at serve time into annotated preview pages only)
  blocks/               One template module per block type (see BLOCK_CATALOG.md, 21 types)
  partials/
    head.js             <head> generator (meta, OG, canonical, fonts, favicon, token :root)
    nav.js              Global navigation (driven by site.nav)
    footer.js           Global footer (driven by site.footer + site contact data)
  lib/
    render.js           Page assembler: walks a page's blocks, calls each block module
    validate.js         Validates content.json against the schema; clear error messages
    escape.js           HTML-escaping helpers
    icons.js            Named inline-SVG set (icon blocks reference these by name)
    patch.js            Canonical patch resolver — single source of truth for write allowlist
                        AND the safeTokens allowlist + token value guards (§9)
    owner.js            Owner-editor request handlers: candidate copy, pending change,
                        approve/discard/restore, publish (§13)
    sitemap.js          Edit-map generator — compact per-client map of editable fields
  schema/
    content.schema.json JSON Schema (draft 2020-12) for content.json

themes/
  default/              Full theme: tokens.json + css/styles.css + js/main.js (shared base)
  <preset>/             Token presets: tokens.json only, cssBase: "default"
                        (clean, warm, restaurant, auto, salon, fitness, landscape, vet,
                         realty, childcare, trades, events)

clients/
  <client-name>/
    content.json        The entire site as data
    img/                Client images (logos, hero, gallery photos)
    owner-config.json   Optional owner-editor config (§13): display name, publish
                        command, contact, host/port
  <client-name>__candidate/   Working copy used by the owner editor (gitignored;
                        recreated from live on session start and on Discard)

attic/                  Archived v3 model-tier modules (repair, patch-schema, triage,
                        AGENT_INSTRUCTIONS.md, test harness, scorecards); not imported
                        by any active code

dist/                   Build output (one folder per client)

BLOCK_CATALOG.md        Reference: every block type and its fields
SPEC.md                 This file
```

---

## 4. The Build Script (`engine/build.js`)

Contract:

- **Input:** a client name (e.g. `node build.js example-contractor`). Reads
  `clients/<name>/content.json` and `clients/<name>/img/`.
- **Step 1 — Validate.** Validate `content.json` against `schema/content.schema.json`.
  On failure, print the failing path and exit non-zero. Do not write any output.
  Also verify block-id and item-id uniqueness.
- **Step 2 — Assemble.** For each page, build a full HTML document: `head` partial
  (including the `:root` token block from `tokens.json` ⊕ `site.themeOverrides`) → `nav`
  → each block in order → `footer`.
- **Step 3 — Emit.** Write pages to `dist/<name>/`, plus `sitemap.xml`, `robots.txt`;
  copy theme CSS (theme's own css/ or its cssBase's), shared JS (default base + theme
  overlay), and client `img/`.
- **No partial writes.** Either the whole site builds or nothing is written.
- **`--annotate` (preview only).** Emits an annotated build to a separate directory
  `dist/<name>__annotated/` (§12). Live builds (no flag) are byte-identical to pre-v4
  output and carry no ids or annotations.

---

## 5. Global vs Per-Page Data

`content.json` has a top-level `site` object holding everything global and repeated:
business name, contact details, logo paths, social links, nav items, footer columns,
theme name, `baseUrl`, and optional `themeOverrides`. Per-page content lives under
`pages[]`: a `slug`, a `meta` object, and an ordered `blocks[]` array. Each block has a
stable `id`, a `type` (must exist in the block registry), and a `fields` object whose
shape is defined by that block type in BLOCK_CATALOG.md.

---

## 6. Block Instance IDs

Every block instance carries a stable, human-readable `id`. IDs are unique within a
client. They are the addressing system the maintenance tier uses. The same applies to
every repeating object item inside a block (cards, quotes, albums, plans, members, rows,
pairs, stats, steps, faq items, contact-info items). IDs must never be auto-generated or
renamed by the maintenance tier, and must never appear in rendered HTML.

---

## 7. What to Build

1. The engine exactly as structured in §3, with all block modules from BLOCK_CATALOG.md.
2. The JSON Schema covering `site`, `pages`, and every block type's `fields`.
3. The default theme (token-driven stylesheet + shared JS) and the token presets listed
   in themes/README.md.
4. Three worked clients: `example-contractor` (5 pages, every core block),
   `example-league` (3 pages, proves the abstraction crosses business types), and
   `example-restaurant` (3 pages, `restaurant` theme, demonstrates the v2 blocks).
   Placeholder image filenames; do not fabricate binary images.
5. Root `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `themes/README.md`.

Build to the spec. If something is underspecified, choose the simplest option that
preserves data/template separation and owner safety, and note the choice in the README.

---

## 8. Maintenance Tier — Patch System

The complete behavioural definition lives in the code it describes — `engine/lib/patch.js`
and `engine/lib/sitemap.js` carry exhaustive header comments and are the source of truth.
This section is a navigational summary.

### 8.1 Patch format

```json
{ "action":"set", "block":"home-hero", "field":"headline", "value":"New headline." }
{ "action":"set", "block":"home-services", "item":"card-renovations", "field":"body", "value":"..." }
{ "action":"set", "block":"site", "field":"contact.phone", "value":"780-555-0142" }
{ "action":"set", "block":"home-hours", "field":"items", "match":"Old line", "value":"New line" }
{ "action":"append", "block":"gallery-main", "item":"album-deck", "field":"images", "value":"img/x.jpg" }
{ "action":"delete", "block":"home-hours", "field":"items", "match":"Old line" }
{ "action":"set-token", "token":"--color-primary", "value":"#2D6A4F" }
{ "action":"refuse", "reason":"..." }
```

Blocks and repeating items are always addressed by stable `id`, never by array index.

### 8.2 Canonical patch resolver (`engine/lib/patch.js`)

Single source of truth for how a patch is applied and what writes are allowed. Both the
production CLI and the test harnesses import this module — they can never diverge.

Safety invariants enforced in code:
- `id`, `type`, and `slug` are never writable.
- You cannot replace a whole object/array container.
- The target field must already exist; the only creation allowed is `append` adding one
  element to an existing list, and `set-token` writing one allowlisted key into
  `site.themeOverrides`.
- A field may not be set without a value.
- `themeOverrides` is unreachable by plain `set` (container AND dotted paths) — the
  format-guarded `set-token` path is the only way in.

### 8.3 Production apply CLI (`engine/apply-patch.js`)

```
node engine/apply-patch.js <client> '<patch-json>'
```

Steps: read → backup → parse → resolve → write → rebuild → restore-on-failure. A
maintenance edit can never leave `content.json` in a modified state with a broken site.
`set-token` patches flow through the identical cycle.

### 8.4 Edit-map generator (`engine/lib/sitemap.js` / `engine/sitemap.js`)

The maintenance UI is shown a compact "edit map" instead of the full `content.json`.
The map opens with a THEME TOKENS section (each safe token with its effective value),
then SITE fields, then every block/item by id with short previews. This keeps the
edit surface small and roughly constant as sites grow.

### 8.5 Proof suite

```
node engine/_run-proofs.js
```

Eight proofs run in sequence: (1) live builds carry no block/item ids and no `data-bk-*`
attributes, while an annotated build (§12) carries a `data-bk` annotation for every
editable field the edit map reports and none it does not (all three clients),
(2) a real field edit applies and rebuilds, (3) a forbidden
write is blocked at the resolver, (4) an id-addressed item edit applies end-to-end,
(5) a valid `set-token` persists in `themeOverrides` and reaches the page `:root`,
(6) invalid `set-token` patches — unknown token, unsafe value, plain-`set` bypass, and
a contrast collision — are all rejected with nothing written, (7) the resolver rejects
valueless writes (plain set and match form) and leaves content untouched, (8) the
owner-editor request handlers (§13), exercised directly: an edit writes only the
candidate and rebuilds its annotated preview, the change card derives old → new from
the resolved patch, a second edit is held while one is pending, approve writes live
and produces annotation-free HTML, resolver guards hold on the UI path, and uploads
stay candidate-side until approve and vanish on discard. All eight must
pass on a clean tree.

---

## 9. Token-Level Editing (v2)

The maintenance tier may change a narrow, safe class of appearance values: brand-identity
theme tokens. The design:

- **`SAFE_TOKENS` allowlist** lives in `engine/lib/patch.js`: `color-primary`,
  `color-accent`, `btn-primary-bg`, `nav-bg`, `footer-bg` (type `color`) and
  `hero-overlay-opacity` (type `opacity`). Inclusion criterion: a wrong value may be
  ugly but can never break layout or readability on its own. Fonts, sizes, spacing,
  radii, grid settings, and EVERY text color are excluded by design — pair-exclusion:
  the maintenance tier may change only the background/brand side of any contrast pair,
  never the text side. (`btn-primary-text` was removed in v3 after live-model testing
  showed small models target it on "text color" requests.)
- **Patch shape:** `{ "action":"set-token", "token":"--color-primary", "value":"#2D6A4F" }`.
  Token names are accepted with or without the `--` prefix and stored without it,
  matching `tokens.json` keys (the build adds `--` at injection).
- **Format guards:** colors accept `#rgb`/`#rrggbb`, plain names, `rgb()/rgba()`,
  `hsl()/hsla()`; opacity accepts 0–1 or 0–100%. A blacklist additionally rejects `;`,
  `{`, `}`, `<`, `>`, `url(`, comments, and escapes — a value can never carry CSS that
  escapes the custom-property declaration.
- **Write target:** `site.themeOverrides[<token>]` — created if absent. This is the ONLY
  write path into `themeOverrides`.
- **Contrast guard (v3):** each editable background token is paired with the
  theme-controlled color rendered on top of it (`TOKEN_PAIRS` in `patch.js`). A
  `set-token` whose value lands below a 1.5 contrast ratio against the pair's effective
  value is rejected — "make the button white" can never produce white-on-white. The
  guard is deliberately permissive (legitimate low-contrast brand palettes pass); it
  exists to catch collisions, not to police taste.
- **Visibility:** the edit map's THEME TOKENS section shows each safe token's effective
  value (preset ⊕ overrides).

---

## 10. Structural Editing (v4)

Structural changes (new pages and blocks) go through a dedicated scaffolder that
instantiates developer-authored blueprints. Owners may only instantiate pre-validated
blueprints; freeform structural editing remains developer work. Blueprint instantiation,
like value editing, produces a CANDIDATE copy reviewed by the owner before the live site
is touched.

`applyPatch` is intentionally NOT extended to cover structural changes — the container
guard and forbidden-key guard must never be weakened. New structure arrives through a
separate code path (see `engine/lib/scaffold.js`, Task 3).

---

## 11. Optional Model Seam

The patch pipeline is the permanent attachment point for an optional copy-assist model
tier. A future model tier would:
1. Receive the edit map from `engine/lib/sitemap.js` (`buildEditMap` / `renderEditMap`).
2. Produce a patch object conforming to one of the shapes in §8.1.
3. Pass it to `applyPatch` — the same resolver the UI uses — with no changes to the
   allowlist, the guards, or the build.

No model-specific code belongs in the active runtime. The archived modules in `attic/`
(`repair.js` — near-miss normalizer, `patch-schema.js` — grammar-constrained schema
builder, `triage.js` — request pre-filter, `AGENT_INSTRUCTIONS.md` — model operating
manual) document the v3.1 approach and are the natural starting point for any future
integration.

---

## 12. Annotated Preview Build (v4)

The owner click-to-edit UI needs to map each on-page element back to the content
field it was rendered from. `node engine/build.js <client> --annotate` produces a
build in which every editable element carries a `data-bk-*` attribute:

- block scalar field → `data-bk-block`, `data-bk-field`
- addressable item field → `data-bk-block`, `data-bk-item`, `data-bk-field`
- text-list line → `data-bk-block`, `data-bk-field`, `data-bk-index`
- site field → `data-bk-block="site"`, `data-bk-field`

**Single source of truth.** The annotator (`engine/lib/annotate.js`) is built from
`buildEditMap` (`engine/lib/sitemap.js`) — the same map the resolver's editable
surface derives from — and every annotation method is gated against it. A renderer
cannot stamp a field the map does not report, and proof 1 enforces the converse: every
field the map reports is stamped. UI coverage and engine coverage therefore cannot
diverge.

**Preview-only, never live.** Annotated builds go to `dist/<client>__annotated/`, a
separate directory, so they can never be mistaken for or deployed as the live site.
Live builds substitute no-op annotators (`render.js`), so their HTML is byte-identical
to pre-v4 output and contains no ids or `data-bk-*` (the live half of proof 1). This is
how the "live builds never contain ids or editing annotations" invariant is enforced.

**Coverage scope.** Annotations live on the per-element click-to-edit surface: every
block scalar, item field, and text-list line (proof 1 enforces this in full). Two
classes of edit-map field are editable by the engine but have no dedicated clickable
element, so they are gated (any annotation present is valid) but not proof-required:
site config fields rendered only into `<head>`/attributes (`baseUrl`, `theme`,
`logo.*`), reached via a settings affordance; and dotted object-leaf block scalars that
share one rendered element (e.g. `button.label`/`button.href`/`button.style` on one
`<a>`), reached via the field-group editor. The edit map remains the single source of
truth for both surfaces.

---

## 13. Click-to-Edit Owner Editor (v4)

`node engine/serve.js <client>` runs a local server (stdlib `http`, bound to
`127.0.0.1` by default) serving one page: the client's ANNOTATED candidate build in an
iframe beside a pending-change panel. All editing logic lives in `engine/lib/owner.js`
as plain handler functions; `engine/serve.js` is HTTP plumbing only, so proof 8
exercises the handlers directly.

- **Candidate copy.** The session works on `clients/<client>__candidate/` (gitignored),
  a full copy of the live client reset from live at session start and on Discard. It is
  built annotated to `dist/<client>__candidate__annotated/`; that build IS the preview.
  Only Approve writes inside `clients/<client>/`.
- **Overlay.** `engine/ui/overlay.js` is injected at serve time into preview HTML (never
  written to disk, never into live builds). It highlights `data-bk-*` elements on hover
  and posts the clicked (block, item?, field, index?) reference to the editor app.
- **Editors by field shape** (decided server-side from the candidate's current value):
  short text → input; long text → textarea; text-list line → edit/remove that line
  (match-form patch built from the exact current line) or append a new one; image →
  file picker (the server validates, stores into the candidate's `img/`, and assigns
  the path itself); gallery image list → append/remove; brand colors → picker bound to
  `SAFE_TOKENS`, running the format + contrast guards live (`/api/token-check`) with
  the resolver's own plain-language explanation shown inline on rejection.
- **Flow.** Edit → patch constructed deterministically → `applyPatch` on the candidate
  (every guard runs; UI input is untrusted input) → candidate rebuild (annotated;
  a failing build rolls the candidate back) → iframe refresh + change card whose
  old → new values are read by resolving the patch address against the candidate
  content. Exactly one pending change at a time. Approve → live `content.json` (+ any
  uploaded image) written, live rebuilt WITHOUT annotations, publish command run.
  Discard → candidate reset from live. Restore → revert the last publish commit
  (found via the `[blockson-publish <client>]` marker), rebuild, republish.
- **Publish.** Configured per client in `owner-config.json`: `"git"` (default —
  add/commit/push with a templated message), `"none"`, or a custom command string with
  `{message}`/`{client}` placeholders. Missing git or a failing command is reported in
  plain language; the live site stays updated locally either way.
- **Security.** Non-local requests are rejected (socket + Host header) unless
  explicitly configured; POSTs require a custom header no cross-origin page can send
  without a CORS preflight (which the server never grants); static paths are confined
  to their roots; upload names are sanitized against an image-extension allowlist and
  size cap; the UI renders all values via `textContent`.
