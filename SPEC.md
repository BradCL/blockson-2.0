# Static Site Engine — Build Specification (v2)

This document is the authoritative spec for a reusable static-site engine. Implement it
exactly as written. Do not introduce frameworks, alternative architectures, or naming
conventions not described here. Where this spec is silent, prefer the simplest option
consistent with the principles below.

v2 additions over the original spec: §9 (token-level editing via the maintenance tier),
the v2 block set in BLOCK_CATALOG.md, and the theme-preset system in themes/README.md.

---

## 1. Purpose

This engine generates static marketing websites for small local businesses from a single
data file per client. One engine, many clients. A client site is fully described by one
`content.json` file plus a folder of images. Changing the data file changes the site;
the engine code never changes per client.

The engine exists to support a two-tier maintenance model:

- **Setup tier** (a developer, using full tooling): defines clients, assembles pages from
  blocks, can edit anything.
- **Maintenance tier** (a small local LLM, ~3B parameters, acting on plain-English email
  requests from the business owner): edits *only existing values* inside `content.json`,
  plus the curated safe-token allowlist (§9). It never adds, removes, or reorders blocks,
  and never touches engine code, CSS, JS, or the build script.

Every design decision below serves making that maintenance tier *safe for a small model*.

---

## 2. Core Principles

1. **Data/template separation is absolute.** All client-specific content lives in
   `content.json`. All structure lives in block templates. All styling lives in the theme
   tokens + shared CSS. These never mix.
2. **No build-time intelligence required for maintenance.** Editing content is editing
   JSON values. A model that can find a key and change its value can maintain any site.
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
  apply-patch.js        Production maintenance CLI (content + token patches)
  sitemap.js            Edit-map inspection CLI
  new-client.js         Client scaffolder
  _run-proofs.js        Proof suite (6 proofs)
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
    sitemap.js          Edit-map generator — compact per-client map shown to the model
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

dist/                   Build output (one folder per client)

AGENT_INSTRUCTIONS.md   Ships INTO each client folder; the local model's operating manual
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

The build script is **setup-tier only**. The maintenance model never runs it; the
developer re-runs the build after a content edit (or it runs in CI on commit).

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
client. They are the addressing system the maintenance model uses. The same applies to
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
5. `AGENT_INSTRUCTIONS.md` copied into each client folder on build (root copy canonical).
6. Root `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `themes/README.md`.

Build to the spec. If something is underspecified, choose the simplest option that
preserves data/template separation and small-model safety, and note the choice in the
README.

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
- A field may not be set to `null`.
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

The maintenance model is shown a compact "edit map" instead of the full `content.json`.
The map opens with a THEME TOKENS section (each safe token with its effective value),
then SITE fields, then every block/item by id with short previews. This keeps the
model's input small and roughly constant as sites grow.

### 8.5 Model instruction file

`AGENT_INSTRUCTIONS.md` is the canonical operating manual for the maintenance model,
copied into every client folder on build. The root copy is the source of truth.

### 8.6 Proof suite

```
node engine/_run-proofs.js
```

Seven proofs run in sequence: (1) block and item ids do not appear in rendered HTML
across core AND v2 blocks, (2) a real field edit applies and rebuilds, (3) a forbidden
write is blocked at the resolver, (4) an id-addressed item edit applies end-to-end,
(5) a valid `set-token` persists in `themeOverrides` and reaches the page `:root`,
(6) invalid `set-token` patches — unknown token, unsafe value, plain-`set` bypass, and
a contrast collision — are all rejected with nothing written, (7) the repair pass fixes
known near-miss shapes and never invents targets. All seven must pass on a clean tree.

A live-model test harness against Ollama (`test-agent-map.js`) scores real models but is
not part of the pass/fail gate.

---

## 9. Token-Level Editing (v2)

The maintenance tier may change a narrow, safe class of appearance values: brand-identity
theme tokens. The design:

- **`safeTokens` allowlist** lives in `engine/lib/patch.js` (exported as `SAFE_TOKENS`):
  `color-primary`, `color-accent`, `btn-primary-bg`, `nav-bg`, `footer-bg` (type
  `color`) and `hero-overlay-opacity` (type `opacity`). Inclusion criterion: a wrong
  value may be ugly but can never break layout or readability on its own. Fonts, sizes,
  spacing, radii, grid settings, and EVERY text color are excluded by design —
  pair-exclusion: the model may change only the background/brand side of any contrast
  pair, never the text side. (`btn-primary-text` was removed in v3 after live-model
  testing showed small models target it on "text color" requests.)
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
  value (preset ⊕ overrides), so the model can answer "what is our brand color?" and
  knows exactly which names are legal.

---

## 10. Small-Model Hardening (v3)

Three additive layers move intelligence from the model into deterministic code, so the
maintenance tier keeps working as models shrink:

- **Repair pass** (`engine/lib/repair.js`): rewrites the known family of near-miss
  patches (site field name written into `block`, token name in the wrong slot, stray
  keys) BEFORE the resolver. Rules only rewrite to targets that provably exist in the
  client's content; everything still flows through `applyPatch`. Used by
  `apply-patch.js` and the harness.
- **Per-request patch schema** (`engine/lib/patch-schema.js`): generates a JSON Schema
  whose `block`/`item`/`token` properties are ENUMS of the client's real ids and the
  safe tokens. Passed as Ollama's `format` (structured outputs), the model is
  grammar-constrained — it cannot emit an address that doesn't exist. The schema
  constrains shape, not safety; the resolver remains the gate.
- **Retry-with-error** (harness, and recommended for any UI integration): when the
  resolver rejects, the rejected patch plus the exact error message is sent back to the
  model once for a corrected attempt; small models correct named mistakes far more
  reliably than they avoid them first-shot. Bounded (default 1 retry), then refuse.

Evaluation policy: harness scorecards report **safety failures** (a refuse-case patch
the resolver would have accepted) separately from **helpfulness failures** (refusals of
valid requests, resolver-caught mistakes). The ship gate for any model is safety = 0;
helpfulness is best-effort because its failure mode is "email the developer".
