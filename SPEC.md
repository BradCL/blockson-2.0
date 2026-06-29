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
  existing values* inside `content.json` (including the per-block hide/show flag),
  plus the curated safe-token allowlist (§9), and may instantiate developer-blessed
  **blueprints** — new pages, new blocks, and new repeating items, all recombining
  existing block types — through the scaffolder (§10), which also removes a
  repeating item where (and only where) an item blueprint blesses that array. It
  never reorders existing blocks or items, never authors freeform structure, and
  never touches engine code, CSS, JS, or the build script. The structural-edit
  policy in one line: **owners add and remove only what a blessed blueprint
  expresses; freeform structure remains developer work.**

Every content write, regardless of origin, passes through `applyPatch` and a candidate
build before touching the live site. The owner sees a preview, keeps changes into a
session, and ships the whole session with one explicit Publish (§13).

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
   content, no tracking — and no external resources: local-first means no CDN fonts
   and no remote scripts; font tokens are self-contained stacks, and a theme that
   needs a specific face self-hosts it. SEO-complete (canonical tags, meta, sitemap,
   OG tags).
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
  validate-blueprint.js Blueprint acceptance CLI (schema → sample instantiation →
                        full build → invariant checks; see §10.2)
  blueprints-check.js   Whole-registry check + demo-gallery regeneration
                        (npm run blueprints:check; see §10.2)
  validate-theme.js     Theme acceptance CLI (tokens → value safety → hard rules →
                        contrast pairs → coverage build; see THEME_AUTHORING.md)
  _run-proofs.js        Proof suite (20 proofs)
  ui/                   Owner editor app: index.html + ui.js + ui.css, and overlay.js
                        (injected at serve time into annotated preview pages only)
  blocks/               One template module per block type (see BLOCK_CATALOG.md, 21 types)
  partials/
    head.js             <head> generator (meta, OG, canonical, favicon, token :root;
                        local-first — emits no external resource links)
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
                        staged session, keep/discard/publish/restore, the
                        maintenance ledger (§13)
    scaffold.js         Blueprint scaffolder + item removal — the only structural
                        path (§10)
    bpcheck.js          Blueprint authoring-kit pipeline behind validate-blueprint /
                        blueprints-check, incl. the all-blocks showcase corpus (§10.2)
    themecheck.js       Theme acceptance pipeline behind validate-theme.js
    sitemap.js          Edit-map generator — compact per-client map of editable fields
  schema/
    content.schema.json JSON Schema (draft 2020-12) for content.json

blueprints/             Developer-authored page/block/item layouts the owner may
                        instantiate (one JSON file each; validated on load — see §10)

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
                        command, contact, host/port, access token
    edits.log.jsonl     Maintenance ledger (§13) — one JSONL line per owner attempt
                        (gitignored; rotates to edits.log.1.jsonl at 1 MB)
  <client-name>__candidate/   Working copy used by the owner editor (gitignored;
                        recreated from live on session start and on Discard all)
  blueprint-gallery/    GENERATED demo client: every blueprint × variant instantiated
                        from example inputs (visual gallery + regression corpus,
                        regenerated by npm run blueprints:check — committed; §10.2)

attic/                  Archived v3 model-tier modules (repair, patch-schema, triage,
                        AGENT_INSTRUCTIONS.md, test harness, scorecards); not imported
                        by any active code

dist/                   Build output (one folder per client)

BLOCK_CATALOG.md        Reference: every block type and its fields
BLUEPRINT_AUTHORING.md  The complete, self-sufficient contract for authoring a
                        blueprint from outside this codebase (§10.2)
THEME_AUTHORING.md      The complete contract for contributing a theme (required
                        tokens, hard rules, contrast pairs, coverage)
CONTRIBUTING.md         The three contribution lanes and their review bar
OPERATOR.md             Developer deploy guide: hosting, owner-config.json,
                        publish/rollback story (§13)
SPEC.md                 This file
```

---

## 4. The Build Script (`engine/build.js`)

Contract:

- **Input:** a client name (e.g. `node build.js example-contractor`). Reads
  `clients/<name>/content.json` and `clients/<name>/img/`.
- **Step 1 — Validate.** Validate `content.json` against `schema/content.schema.json`.
  On failure, print the failing path and exit non-zero. Do not write any output.
  Also verify block-id and item-id uniqueness. The schema scheme-checks every link
  target (`$defs/safeHref`): an `href` may be `https`/`http`/`mailto`/`tel`/`sms`,
  a `#anchor`, or a relative path — `javascript:` and friends fail the build;
  `formAction` and `mapEmbedUrl` must be `https://`. The stdlib fallback validator
  (used only when AJV is absent) enforces the same scheme rules.
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

Nineteen proofs run in sequence: (1) live builds carry no block/item ids and no `data-bk-*`
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
the resolved patch, a second edit is held while one is pending, keep stages the
change and frees the next edit, a pending-discard replays the staged list without
disturbing it, publish writes the whole session to live in one step and produces
annotation-free HTML, resolver guards hold on the UI path, uploads stay
candidate-side until publish and vanish on discard-all, and non-image bytes under
an image filename are refused by the file-signature guard, (9) the blueprint scaffolder
(§10): the registry validates all shipped blueprints, invalid inputs are rejected with
nothing written, ids stay unique site-wide under repeated instantiation, and every
blueprint × variant builds clean, (10) scaffolding through the owner handlers: the new
page lands annotated in the candidate only, the pending interlock covers edits and
scaffolds both ways, a kept page survives a pending-discard replay with the same ids,
and publish puts the page + nav entry + sitemap line live with no
annotations and no ids, (11) the blueprint authoring kit (§10.2): every shipped
blueprint clears the acceptance pipeline, the committed demo gallery matches
deterministic regeneration (a stale gallery fails the suite), the live gallery build
carries no annotations or id attributes, a known-bad blueprint fails the validator
CLI with named reasons, and a blueprint smuggling a `javascript:` link is stopped at
the build gate, (12) the theme validator: every shipped theme passes (token
completeness, injection + format guards on values, no JS / no external resources,
tiered contrast pairs, demo-client coverage build), the demo corpus covers the whole
block registry, and a known-bad theme fails with each reason named, (13) the editor
server's request guards, probed over real HTTP: a foreign `Host` header and a
header-less POST are refused, encoded path traversal cannot escape the preview/UI
roots, every response carries `nosniff` + `SAMEORIGIN` headers, remote-open
refuses to start without an access token, and a configured token gates every
request (wrong/no token refused with a plain page; the right token admits and
issues an HttpOnly session cookie) while loopback-without-token is unchanged, (14) the
build-time image weight advisory: a >500 KB file in `img/` is named on stderr with
its size and a one-sentence fix, a >2 MB folder gets a one-line total, and the
build still succeeds — advisory warnings never change a build's exit code or
output, (15) contact-form delivery: endpoint-mode rendering equals the previous
output plus exactly the honeypot element, netlify mode emits the Netlify form
attributes with `formAction` optional only under that mode (the `https://` guard
holds everywhere else), the honeypot never carries an annotation, the documented
`https://UNCONFIGURED` placeholder warns at build without failing it, and nothing
under `extras/` is required by engine code, (16) the maintenance ledger: every
owner-handler attempt appends one JSONL line to `clients/<client>/edits.log.jsonl`
(ISO timestamp, the request as submitted, the outcome `ok | rejected |
build-failed`, the resolver's error verbatim on rejection), uploads are logged by
name/size only — never file bytes, the file rotates to `edits.log.1.jsonl` past
1 MB, and an unwritable ledger never blocks the edit it describes, (17) the
per-block visibility flag (`fields.hidden`, boolean): a hidden block is absent
from live HTML but stays rendered, annotated, and `data-bk-hidden`-marked in
the preview, the toggle round-trips through `applyPatch` with boolean values,
type preservation holds both ways (strings rejected on the flag, booleans
rejected on text fields and in lists) with nothing written on rejection, an
absent flag means visible, the flag is seeded on every example-client and
starter block, and the migration script is idempotent, (18) session batching
over real git, in a throwaway sandbox repository with a local bare origin:
keeping changes never touches git, publishing a multi-change session makes
exactly one pushed commit carrying the `[blockson-publish <client>]` marker,
and restore refuses while changes are staged then reverts the whole session
as one unit, (19) item blueprints and item removal (§10): the shipped item
blueprints validate, a valid add lands in the named block with a
site-wide-unique item id and builds clean, bad inputs and unknown/wrong-type
targets are rejected with nothing written, remove deletes exactly the
addressed item while refusing the last item and every array without a blessed
item blueprint, both ride pending → keep → publish with annotation-free,
id-free live HTML, and a known-bad item blueprint fails the validator CLI
with named reasons, (20) page-header background inheritance: a page-header
that omits its own `background` inherits the site hero image (the home page's
hero background, derived at build time) even when that hero is not named
`banner.jpg`, an explicit page-header background still wins, and a site with
no hero at all emits no inline background so the theme CSS stays the
last-ditch fallback. All twenty must pass on a clean tree.

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

Structural changes (new pages, new blocks, and adding/removing repeating items) go
through a dedicated scaffolder (`engine/lib/scaffold.js`) that instantiates
developer-authored blueprints — and, for items, removes them. Owners may only
instantiate pre-validated blueprints; freeform structural editing remains developer
work. Blueprint instantiation and item removal, like value editing, land in the
CANDIDATE copy, are rebuilt annotated (the full build is the acceptance gate), and
ride the keep → Publish session (§13) — the instantiated candidate IS the preview;
there are no mocked previews.

`applyPatch` is intentionally NOT extended to cover structural changes — the container
guard and forbidden-key guard must never be weakened. Structure arrives and leaves only
through the scaffolder.

A blueprint is one JSON file in `blueprints/` — `{ name, purpose,
kind: "page"|"block"|"item", target?, variants: [{key,label}], inputs: [{key, label,
type: text|textarea|image|select, required?, maxLength?, pattern?, hint?, options?,
variants?, example?}], template: { <variantKey>: fragment } }` — whose template may
use ONLY existing block types (checked against the block registry). An **item**
blueprint additionally declares `target: { blockType, field }` — which block type and
which array field one instantiated item is appended to; its fragment is the item
object itself (an `id` hint plus the item's fields). Template strings carry
`{{inputKey}}` placeholders, the builtins `{{site.name}}` / `{{site.contact.phone}}` /
`{{site.contact.email}}` (so blueprints reuse the site's single source of truth
instead of asking the owner to retype it), and `{{inputKey|paragraphs}}` to expand a
textarea into a paragraph array. Validation is strict — unknown keys anywhere are
rejected by name, so a typo cannot silently weaken an input. An input's optional
`example` must pass the input's own constraints; the authoring validator and the demo
gallery (§10.2) instantiate with examples, which makes one effectively mandatory for
any input declaring a `pattern`. The header comment of `engine/lib/scaffold.js` is the
authoritative format reference; BLUEPRINT_AUTHORING.md is the self-sufficient external
authoring contract.

**Item removal** is the structural counterpart (`scaffold.removeItem`, never
`applyPatch`): one object item, addressed by block id + item id. Enforced in code:
only arrays of id-bearing object items; refused when it would leave the array empty
(whether a block may be empty is the developer's decision — the maintenance tier
never finds out); and refused unless a blessed item blueprint targets that block
type + field — owners remove only what they could also add back, so removal is
never a one-way door. The candidate build remains the acceptance gate.

Guarantees, enforced in code and proved by proofs 9–10 and 19:

- **The registry is the gate.** `loadBlueprints()` schema-validates every file in
  `blueprints/` on load; invalid files are excluded with named reasons and can never be
  offered for instantiation. Adding a blueprint = dropping a JSON file in `blueprints/`
  — zero changes to `scaffold.js` or any other code.
- **Inputs are schema-validated** (type, required, maxLength, pattern, select options,
  image-path shape), with HARD per-type length ceilings that a blueprint's own
  `maxLength` may tighten but never exceed. Any failure: rejected with nothing written.
- **Ids cannot collide.** Page slugs, block ids, and item ids are slugified from the
  template's hints and numeric-suffixed against everything already in the content —
  unique site-wide under repeated instantiation of the same blueprint.
- **Pages join the site fully**: a nav entry is added alongside the page; the sitemap
  picks it up at build; the new blocks are click-to-editable in the annotated candidate
  and carry no ids or annotations in the live build. Instantiated items are
  click-to-editable the same way.
- **Zero per-type special-casing.** Making another block type's items owner-addable
  is dropping one item-blueprint JSON file in `blueprints/` — `scaffold.js` never
  changes.

Eight blueprints ship: three page blueprints — contact page, photo gallery page,
generic content page — each with two layout variants, and five item blueprints —
card (card-grid), FAQ pair (faq), quote (testimonials), team member (team-grid,
with/without-photo variants), and CTA button (hero `actions`, filled/outline
variants).

### 10.1 Tier A / Tier B boundary

Two contribution tiers, split by what they can break:

- **Tier A — blueprints and themes.** Pure recombination and re-skinning of what the
  engine already renders. Blueprints may only use existing block types; themes are
  token sets (plus optional self-contained CSS). Tier A is community-open and
  validator-gated: the machine validator (§10.2 / `validate-blueprint.js` for
  blueprints, `validate-theme.js` per THEME_AUTHORING.md for themes) plus a visual
  check of the demo gallery is the entire review bar. Provenance — hand-written,
  generated, copied from a screenshot — is irrelevant; the validator is the sole
  gate. Lane rules, licensing, and originality requirements live in CONTRIBUTING.md.
- **Tier B — new block types.** Engine changes, maintainer-gated, because a block
  type touches every layer at once. The checklist for one new block type:
  1. renderer module in `engine/blocks/` + registration in `_registry.js`
     (escape every string; give every repeating item a stable `id`);
  2. `fields` shape added to `schema/content.schema.json` (`$defs`, `allOf` entry,
     `type` enum);
  3. CSS in the shared stylesheet (`themes/default/css/styles.css`) with every
     color/radius resolved through tokens, so all theme presets restyle it
     automatically (the work-order phrase "CSS in all themes" maps to this: one
     shared stylesheet IS all token-preset themes; any theme with its own `css/`
     must add coverage too);
  4. edit-map coverage (`engine/lib/sitemap.js` picks up scalars/items/text-lists by
     shape — verify the new block's editable surface appears) and annotation
     coverage in the annotated build;
  5. a sample instance in `SHOWCASE_BLOCKS` (`engine/lib/bpcheck.js`) — the theme
     validator fails every theme until the demo corpus covers the new type
     (deliberate ratchet);
  6. an entry in BLOCK_CATALOG.md and in BLUEPRINT_AUTHORING.md §4;
  7. proof coverage — proof 1 (annotation coverage) must hold with the new block
     in a client, and any new guard behavior gets its own proof.

  Adding a block type never changes existing blocks, clients, or content files
  (core principle 6).

### 10.2 Blueprint authoring kit

The library is self-serve. Three pieces, proved by proof 11:

- **BLUEPRINT_AUTHORING.md** — the complete external authoring contract: blueprint
  JSON schema, id and placeholder rules, the full block-type catalog with every
  field and constraint, the theme-token list, a fully worked example (validated by
  the kit itself), and the "what cannot be expressed" boundary. Sufficient on its
  own to author a valid blueprint from a reference layout.
- **`node engine/validate-blueprint.js <file>`** — the acceptance pipeline: strict
  schema check → sample instantiation of EVERY variant into a throwaway client
  (values from each input's `example`, type defaults otherwise; an item blueprint
  instantiates into a sample block of its target type drawn from
  `SHOWCASE_BLOCKS`) → full live + annotated build → invariant checks (live HTML
  carries no ids and no `data-bk-*`; the annotated build stamps every created
  block and item). Clear pass/fail with named reasons; the throwaway client never
  persists.
- **`npm run blueprints:check`** — runs the same pipeline on the whole registry,
  then regenerates `clients/blueprint-gallery/` deterministically: every page/block
  blueprint × every variant, one page each, instantiated from example inputs, plus
  an "All blocks" showcase page carrying one sample instance of every block type
  (`SHOWCASE_BLOCKS`, the theme-coverage corpus) — into which every item
  blueprint × variant is instantiated. The committed gallery is the
  visual gallery (browse `dist/blueprint-gallery/` under any theme) AND the
  regression corpus: proof 11 fails when the committed file drifts from
  regeneration, so blueprint changes ship together with their regenerated gallery.

---

## 11. Optional Model Seam

The owner-editor request handlers (`engine/lib/owner.js`, §13) are the permanent
attachment point for an optional copy-assist model tier, with no change to the
allowlist, the guards, or the build. Every place such a tier would attach already
exists and is exercised today — by the click-to-edit UI for the human path, and by
proofs 8 and 10 for the handler path directly:

1. **Read the editable surface.** `engine/lib/sitemap.js` (`buildEditMap` for a
   structured view, `renderEditMap` for a text outline) for content fields and
   `SAFE_TOKENS`; `owner.listBlueprints()` (`GET /api/blueprints` over HTTP) for the
   structural menu — name, purpose, variants, and input schema of every blessed
   blueprint.
2. **Produce a content patch.** One of the shapes in §8.1, addressed by the stable
   ids the edit map prints. No other write surface exists.
3. **Produce a structural request.** `{ blueprint, variant, values, uploads?,
   targetPage? | targetBlock? }`, validated by the same `validateInputs` (§10) every
   Add… submission goes through, or `{ block, item }` for an item removal — the
   model's structural vocabulary is exactly the blueprint registry, never freeform
   HTML/JSON.
4. **Apply it.** `owner.applyEdit` / `owner.applyScaffold` / `owner.applyRemoveItem`
   — the exact functions `engine/serve.js` calls for a human. Same guards, same
   candidate build, same one-pending-change interlock; a model-produced change is
   indistinguishable, at every layer below this one, from a UI-produced change.
5. **Keep and Publish.** Either left to the owner (model drafts, human confirms via
   the pending-change card and the session panel) or, for a fully autonomous mode,
   `owner.keep()` + `owner.publish()` themselves — still gated by the configured
   publish step (OPERATOR.md §5/§7) and reversible via `owner.restore()`.

No model-specific code belongs in the active runtime; nothing above requires it. The
archived v3.1 modules in `attic/` (`repair.js` — near-miss normalizer,
`patch-schema.js` — grammar-constrained schema builder, `triage.js` — request
pre-filter, `AGENT_INSTRUCTIONS.md` — model operating manual) document the previous
in-runtime approach, in which the model's output had to be repaired and triaged
because it could name fields that didn't exist; the v4 seam instead bounds the
model's vocabulary to ids and blueprints the registry already validated, which is
why none of those modules are needed for a future integration — they remain only as
a reference.

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
Live builds substitute no-op annotators (`render.js`) — annotation is purely additive,
so live HTML carries no annotation artifacts of any kind: no ids, no `data-bk-*`
(the live half of proof 1). This is how the "live builds never contain ids or editing
annotations" invariant is enforced.

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
iframe beside the session panel — the staged list of kept changes above the
pending-change card. All editing logic lives in `engine/lib/owner.js`
as plain handler functions; `engine/serve.js` is HTTP plumbing only, so proof 8
exercises the handlers directly.

- **Candidate copy.** The session works on `clients/<client>__candidate/` (gitignored),
  a full copy of the live client reset from live at session start and on Discard all.
  It is built annotated to `dist/<client>__candidate__annotated/`; that build IS the
  preview. Only Publish (and Restore) writes inside `clients/<client>/`.
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
- **Add… menu and in-place item controls.** Structural changes ride the same panel:
  the Add… menu lists the validated page and block blueprints by name + purpose, with
  a form generated from the chosen blueprint's input schema (variant-scoped inputs
  included). Item blueprints are offered in place instead — clicking into a block
  whose type one targets puts "Add <thing>…" in the editor pane, and each of that
  block's items gains "Remove this <thing>" with a confirm derived from the item's
  current content. All of it enters the identical pending → keep → Publish cycle
  (§10).
- **Flow.** Edit → patch constructed deterministically → `applyPatch` on the candidate
  (every guard runs; UI input is untrusted input) → candidate rebuild (annotated;
  a failing build rolls the candidate back) → iframe refresh + change card whose
  old → new values are read by resolving the patch address against the candidate
  content. The card renders inside the editor pane (which stays open through the
  Keep/Discard, then re-opens for the next related edit) rather than closing it.
  Exactly one pending change at a time — Keep moves it onto the session's
  staged list and frees the next edit; Discard drops only the pending change,
  reconstructing the candidate from live plus a deterministic replay of the staged
  list (kept changes are never disturbed); Discard all resets the candidate from
  live and empties the session. Publish (refused while a change is pending) → the
  whole staged session written to live `content.json` (+ every image the session
  uploaded), live rebuilt WITHOUT annotations, publish command run ONCE — one
  session, one commit. Restore → revert the last publish commit (found via the
  `[blockson-publish <client>]` marker — the whole session as one unit), rebuild,
  republish.
- **Maintenance ledger.** Every attempt that flows through the handlers (`edit`,
  `scaffold`, `remove-item`, `keep`, `discard`, `discard-all`, `publish`, `restore`)
  appends one JSONL line to `clients/<client>/edits.log.jsonl` (gitignored; rotated
  at 1 MB): ISO timestamp, the request as submitted (uploads by name/size only),
  the outcome, and the resolver's refusal verbatim. Logging is a courtesy, not a
  control — a ledger write failure never blocks the edit it describes. Rejected
  attempts are the roadmap data; accepted ones are the local revision history when
  publish is `"none"`.
- **Publish.** Configured per client in `owner-config.json`: `"git"` (default —
  add/commit/push with a templated message), `"none"`, or a custom command string with
  `{message}`/`{client}` placeholders. Missing git or a failing command is reported in
  plain language; the live site stays updated locally either way.
- **Security.** Non-local requests are rejected (socket + Host header) unless
  explicitly configured — and `allowRemote` REQUIRES a non-empty `accessToken` in
  `owner-config.json` (the server refuses to start remote-open without one): the
  owner opens `?token=…` once, the server verifies it with a constant-time
  comparison and issues an HttpOnly session cookie that every subsequent request,
  static and API alike, must carry; POSTs require a custom header no cross-origin page can send
  without a CORS preflight (which the server never grants); static paths are confined
  to their roots; upload names are sanitized against an image-extension allowlist and
  size cap, and the bytes must carry the file signature (magic bytes) of the claimed
  image type; every response carries `X-Content-Type-Options: nosniff` and
  `X-Frame-Options: SAMEORIGIN`; a `{message}` interpolated into a custom publish
  command is reduced to a conservative character set first; the UI renders all values
  via `textContent`. The request guards are exercised over real HTTP by proof 13.
