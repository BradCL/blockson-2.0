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
  sitemap.js            Edit-map inspection CLI
  new-client.js         Client scaffolder
  _run-proofs.js        Proof suite (7 proofs)
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

Seven proofs run in sequence: (1) block and item ids do not appear in rendered HTML
across core AND v2 blocks, (2) a real field edit applies and rebuilds, (3) a forbidden
write is blocked at the resolver, (4) an id-addressed item edit applies end-to-end,
(5) a valid `set-token` persists in `themeOverrides` and reaches the page `:root`,
(6) invalid `set-token` patches — unknown token, unsafe value, plain-`set` bypass, and
a contrast collision — are all rejected with nothing written, (7) the resolver rejects
valueless writes (plain set and match form) and leaves content untouched. All seven must
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
