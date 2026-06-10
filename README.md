# Blockson — Static Site Engine

One engine, many client sites. A client's entire website is described by a single
`content.json` file plus a folder of images. The engine reads that file, validates it,
and emits complete, SEO-ready static HTML into `dist/`.

Blockson is built for a "set and forget" business model: a developer sets a site up
once, hands it over, and the business owner's day-to-day changes flow through a
deterministic patch system that can only make safe, reversible edits. No CMS, no
database, no hosting bill beyond static files, no maintenance contract required.

Licensed under the [MIT License](LICENSE). Contributions welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## Quick start

**Prerequisites:** Node.js 18 or later. AJV is required for full field-level schema
validation and should be installed before building (without it the build still runs,
with a reduced structural validator and a loud warning).

```
# Install the schema validator
npm install

# Build a client site
node engine/build.js example-contractor

# Output lands in:
#   dist/example-contractor/index.html
#   dist/example-contractor/about.html
#   ...
#   dist/example-contractor/sitemap.xml
#   dist/example-contractor/robots.txt
#   dist/example-contractor/css/  js/  img/
```

Deploy the contents of `dist/<client-name>/` to any static host (GitHub Pages,
Netlify, Cloudflare Pages, an S3 bucket, etc.). For connecting a client repo to a
host, per-client editor configuration, and the publish/rollback story, see
[OPERATOR.md](OPERATOR.md).

---

## Two-tier editing model

| Tier | Who | Can do |
|------|-----|--------|
| **Setup** | Developer with full tooling | Define clients, write new block types, change the engine, update CSS/JS, author themes and blueprints |
| **Maintenance** | Owner, via the click-to-edit editor (`engine/serve.js`) or a patch applied directly | Edit _values_ inside `content.json`, adjust a curated allowlist of brand-color theme tokens, and instantiate developer-blessed **blueprints** (new pages from `blueprints/`) |

Every write, regardless of origin, passes through `applyPatch` (the write-allowlist
resolver in `engine/lib/patch.js`) and a candidate build before touching the live
site. The owner always sees a preview and issues an explicit Approve.

**Structural-edit policy:** owners may instantiate blessed blueprints — that's the
entire structural surface available to the maintenance tier. Freeform structural
editing (new block types, hand-built page layouts, anything not expressible as a
blueprint) remains developer work. `applyPatch` itself is never extended to cover
structure; blueprint instantiation is a separate, dedicated path
(`engine/lib/scaffold.js`, §10 of SPEC.md) with its own validation and its own
candidate/Approve cycle.

Safety is layered, in code, never by trusting any external input:
1. `engine/lib/patch.js` — the write allowlist, the single source of truth: forbidden
   keys, container guard, value-type guard, safe-token allowlist, color format +
   contrast guards
2. JSON Schema validation (AJV, draft 2020-12) before any file is written
3. `apply-patch.js` backs up `content.json` and restores it automatically if the
   rebuild fails — a bad patch can never leave a site broken

---

## Tokens, themes, and `themeOverrides`

Each theme is a `themes/<name>/tokens.json` — a flat map of CSS custom property names
to values (plus `cssBase` naming the stylesheet it rides on). At
build time the preset is merged with the client's optional `site.themeOverrides` map and
injected into every page as a `:root { … }` block. Built sites are local-first:
no CDN fonts or other external resources — font tokens are self-contained stacks
(see [themes/README.md](themes/README.md)). The shared stylesheet references
tokens via `var(--token-name)`, so one proven CSS file serves every theme.

**Selecting a preset:** set `site.theme` in `content.json` to the preset folder name.
Token-only presets declare `"cssBase": "default"` and reuse the default theme's CSS and
JS. **Building a custom theme:** copy a preset folder, change the token values, and (only
if you need structural CSS changes) add a `css/styles.css` to the theme folder — the
build prefers a theme's own CSS when present. The full authoring contract is
[THEME_AUTHORING.md](THEME_AUTHORING.md); validate with
`node engine/validate-theme.js themes/<name>`.

**Per-client tweaks** go in `site.themeOverrides` (e.g. `"color-primary": "#2D6A4F"`),
which the developer can write directly — and which the maintenance tier can reach
through the `set-token` patch.

### Theme presets (12)

| Preset | Vertical | Identity |
|--------|----------|----------|
| `default` | Contractor / general | Dark, bold — Outfit + DM Sans, amber on charcoal |
| `clean` | General / professional | Light, blue — Montserrat + Open Sans |
| `warm` | General / friendly | Cream + warm orange — Nunito |
| `restaurant` | Casual dining / café | Cream + terracotta — Fraunces serif headings |
| `auto` | Auto repair / tire shop | Gunmetal + safety orange — Barlow Condensed |
| `salon` | Hair / beauty / spa | Blush + dusty rose + soft gold — Cormorant Garamond |
| `fitness` | Gym / studio | Near-black + electric lime — Archivo |
| `landscape` | Landscaping / lawn care | Sage + leaf green + ochre — Merriweather |
| `vet` | Veterinary / grooming | Soft teal + warm orange — Quicksand |
| `realty` | Real estate / property | White + navy + gold — Playfair Display |
| `childcare` | Daycare / early learning | Cream + coral + teal, big radii — Baloo 2 |
| `trades` | Plumbing / HVAC / electrical | Light steel + bright blue + safety yellow — IBM Plex |
| `events` | Event / wedding venue | Deep plum + champagne — Marcellus |

Design intent and full token reference: [themes/README.md](themes/README.md).

---

## Block types (21)

Core: `hero`, `page-header`, `text`, `card-grid`, `gallery`, `testimonials`,
`list-panel`, `service-area`, `contact-cards`, `contact-info`, `contact-form`, `cta`

v2: `pricing-table`, `team-grid`, `faq`, `hours-table`, `before-after`, `stats-bar`,
`process-steps`, `video-embed`, `booking-cta`

`contact-form` has a selectable, subscription-free delivery mode: the default
endpoint mode POSTs to an `https://` `formAction` (the Cloudflare Worker shipped in
`extras/cloudflare-form-worker/`, or a relay), while `delivery: { "mode": "netlify" }`
renders Netlify's native form attributes — nothing to deploy. Every form carries a
hidden honeypot. The per-host story is "Contact form delivery" in
[OPERATOR.md](OPERATOR.md).

Fields, CSS classes, and per-block maintenance permissions: [BLOCK_CATALOG.md](BLOCK_CATALOG.md).

Page layouts owners can instantiate themselves are **blueprints** (`blueprints/`) —
recombinations of these block types behind a validated input form. Owners instantiate
them through the click-to-edit editor's **Add…** menu (below). The complete
authoring contract is [BLUEPRINT_AUTHORING.md](BLUEPRINT_AUTHORING.md); validate with
`node engine/validate-blueprint.js <file>` and `npm run blueprints:check` (which also
regenerates the `clients/blueprint-gallery/` demo client — the visual gallery and
regression corpus).

---

## Adding a new client

```
node engine/new-client.js <client-name> [theme]
```

This scaffolds `clients/<client-name>/` with a starter `content.json` on the chosen
theme (default: `default`) and an empty `img/` folder. Then edit the content, add
images, and build:

```
node engine/build.js <client-name>
```

The build **validates first**. It will not write a single file if `content.json` fails
the schema. The error message names the exact field path that failed.
(The `clients/example-*` folders are the canonical references — contractor for the core
blocks, restaurant for the v2 blocks.)

---

## Applying a patch

```
# See the compact edit map (tokens + all blocks with their current values):
node engine/sitemap.js <client>

# Apply a patch directly:
node engine/apply-patch.js <client> '<patch-json>'

# Examples:
node engine/apply-patch.js example-contractor '{"action":"set","block":"site","field":"contact.phone","value":"780-555-0142"}'
node engine/apply-patch.js example-contractor '{"action":"set-token","token":"--color-primary","value":"#2D6A4F"}'
```

The apply tool: reads `content.json` → backs it up → applies the patch through the
safety resolver → rebuilds the site. If the build fails for any reason, the original
`content.json` is restored automatically.

Patch shapes:

```json
// Set a scalar field on a block
{ "action":"set", "block":"home-hero", "field":"headline", "value":"New headline." }

// Set a field on a repeating item (card, plan, row, member…), addressed by item id
{ "action":"set", "block":"home-services", "item":"card-renovations", "field":"body", "value":"..." }

// Set a site-wide field
{ "action":"set", "block":"site", "field":"contact.phone", "value":"780-555-0142" }

// Replace one line in a plain text list by matching its current text exactly
{ "action":"set", "block":"home-hours", "field":"items", "match":"Office: Tue 6-8pm", "value":"Office: Wed 6-8pm" }

// Append a photo to an existing gallery album
{ "action":"append", "block":"gallery-main", "item":"album-deck", "field":"images", "value":"img/deck-3.jpg" }

// Delete one line from a plain text list
{ "action":"delete", "block":"home-hours", "field":"items", "match":"Office: Tue 6-8pm" }

// Change a SAFE theme token (brand colors / hero overlay only — see SAFE_TOKENS in patch.js)
{ "action":"set-token", "token":"--color-primary", "value":"#2D6A4F" }

// Refuse an out-of-scope request
{ "action":"refuse", "reason":"Adding a page is structural; refer to the developer." }
```

`set-token` is the only write path into `site.themeOverrides`; values pass strict
per-type format guards (hex/named/rgb()/hsl() colors, 0–1 opacity), an injection
blacklist, and a **contrast guard** — an editable background can never be set close
enough to its theme-controlled text color to become unreadable. Plain `set` patches
targeting `themeOverrides` are rejected at the resolver.

---

## Annotated preview build

```
node engine/build.js <client> --annotate
```

The owner click-to-edit editor (`engine/serve.js`, below) needs to know, for each
element on the page, which content field it came from. An annotated build stamps every
editable element with `data-bk-block` / `data-bk-item` / `data-bk-field` (and
`data-bk-index` for text-list lines), driven by the **same edit map**
(`engine/lib/sitemap.js`) the patch resolver's editable surface is derived
from — so UI coverage and engine coverage can never diverge
(`engine/lib/annotate.js`). An overlay script can then highlight elements on
hover and open the right editor on click.

An annotated build is a **preview-only artifact** and is written to a separate
directory, `dist/<client>__annotated/`, so it can never be mistaken for or
deployed as the live site. **Live builds (no flag) never contain ids or any
`data-bk-*` attribute** — proof 1 guards both halves: live HTML is clean, and
the annotated build carries an annotation for every editable field the map
reports.

Annotations live on the per-element click-to-edit surface: every block scalar,
item field, and text-list line. Two classes of edit-map field are editable by
the engine but have no dedicated clickable element and so are reached through a
settings/field-group affordance rather than an on-page click — site config
fields rendered only into `<head>`/attributes (`baseUrl`, `theme`, `logo.*`),
and dotted object-leaf scalars that share one rendered element (e.g.
`button.label`/`button.href`/`button.style` on one `<a>`). The edit map remains
the single source of truth for both surfaces.

---

## Click-to-edit owner editor

```
node engine/serve.js <client> [--port N] [--host ADDR] [--allow-remote]
```

A local server (binds `127.0.0.1` by default) serving one page: an iframe showing
the client's **candidate** copy (`clients/<client>__candidate/`, gitignored — a full
copy of live, reset on session start and on Discard) built **annotated**, beside a
pending-change panel. The candidate build IS the preview; nothing here is mocked.

- **Overlay** (`engine/ui/overlay.js`, injected at serve time into the candidate
  preview only — never written to disk, never in live builds) highlights every
  `data-bk-*` element on hover; clicking one opens the editor matching its field:
  short text → inline input, long text → textarea, a text-list line → edit/append/
  remove that line, an image field → file picker (saved into the candidate's
  `img/`), brand colors → a picker bound to `SAFE_TOKENS` that runs the format and
  contrast guards live and explains a rejection in plain language. Picked images
  are compressed in the browser before upload (scaled to ≤1920 px, re-encoded —
  PNG → WebP, the rest → JPEG; EXIF, including GPS, is stripped), so a 4 MB phone
  photo lands as a page-friendly few hundred KB; the server still treats the
  result as untrusted input and runs every upload guard on it.
- **Add… menu** lists the validated blueprint registry by name + purpose; choosing
  one shows a form generated from its input schema, and instantiating it enters the
  same pending → preview → Approve/Discard cycle as a content edit.
- **One pending change at a time.** Edit or scaffold → `applyPatch`/`scaffold`
  resolves and validates on the candidate (every guard runs — UI input is untrusted
  input) → candidate rebuilds annotated (a failing build rolls the candidate back) →
  the change card shows old → new, read by resolving the patch against the
  candidate content (never from any other description of the change).
- **Approve** writes live `content.json` (+ any uploaded image), rebuilds live
  WITHOUT annotations, and runs the configured publish step. **Discard** resets the
  candidate from live. **Restore** reverts the last published change, rebuilds, and
  republishes.
- **Security:** non-local requests are rejected (socket + `Host` header) unless
  `--allow-remote` is set; every POST requires a custom header no cross-origin page
  can send without a CORS preflight, which this server never grants; static paths
  are confined to their roots; uploads are extension-, size-, and file-signature-
  checked (the bytes must be the image type the name claims); every response
  carries `nosniff` and `SAMEORIGIN` headers; all values render via `textContent`.

Per-client config (publish command, display name, contact, host/port) lives in
`clients/<client>/owner-config.json` — see [OPERATOR.md](OPERATOR.md) for the full
field reference, hosting setup, and the publish/rollback story.

---

## Optional model seam

The owner-editor request handlers (`engine/lib/owner.js`) are the permanent seam
where an optional copy-assist model tier could attach in a future version, with no
change to the resolver, the guards, or the build. Every attachment point already
exists and is exercised today by the editor above and by the proof suite:

1. **Read the editable surface** — `engine/lib/sitemap.js`
   (`buildEditMap`/`renderEditMap`) for content fields and safe tokens;
   `GET /api/blueprints` (`scaffold.loadBlueprints()`) for the structural menu.
2. **Produce a content patch** — one of the shapes in *Applying a patch* above,
   addressed by the stable ids the edit map prints.
3. **Produce a structural request** — `{ blueprint, variant, values }`, validated
   by the same `validateInputs` every Add… submission goes through.
4. **Apply it** — `owner.applyEdit` / `owner.applyScaffold`, the exact functions
   `engine/serve.js` calls; same guards, same candidate build, same pending →
   Approve/Discard cycle.
5. **Approve** — left to the owner (model drafts, human confirms) or, for a fully
   autonomous mode, `owner.approve()` itself, still gated by the same publish step.

No model-specific code belongs in the active runtime; none of the above requires
it. The archived v3.1 modules in `attic/` (`repair.js`, `patch-schema.js`,
`triage.js`, `AGENT_INSTRUCTIONS.md`) document the previous in-runtime approach and
remain available as a reference for any future integration.

---

## Testing

```
node engine/_run-proofs.js     # or: npm test
```

Runs sixteen end-to-end proofs against the example clients and the full contribution
pipeline:
1. live HTML carries no item ids and no `data-bk-*` attributes; an annotated
   build (`--annotate`) carries a `data-bk` annotation for every editable field
   the edit map reports, and none it does not (checked across all three clients)
2. a real field edit applies and rebuilds
3. a forbidden structural write is blocked at the resolver
4. an id-addressed item edit applies end-to-end
5. a valid `set-token` persists in `themeOverrides` and reaches the page `:root`
6. invalid `set-token` patches (bad token, bad value, plain-`set` bypass, contrast
   collision) are all rejected
7. the resolver rejects valueless writes (both plain set and match form), nothing written
8. the owner-editor handlers (*Click-to-edit owner editor*, above): edit → candidate
   → annotated rebuild → change card, Approve writes live with no annotations, one
   pending change at a time, uploads stay candidate-side until Approve and vanish
   on Discard, and non-image bytes under an image filename are refused by the
   file-signature guard
9. the blueprint scaffolder: every shipped blueprint validates, invalid inputs are
   rejected with nothing written, ids stay unique site-wide under repeated
   instantiation, and every blueprint × variant builds clean
10. blueprint scaffolding through the owner handlers: the new page lands annotated
    in the candidate only, the pending interlock covers edits and scaffolds both
    ways, and Approve puts the page + nav entry live with no annotations or ids
11. the blueprint authoring kit: every shipped blueprint clears
    `validate-blueprint.js`, the committed demo gallery matches deterministic
    regeneration, a known-bad blueprint fails with named reasons, and a blueprint
    smuggling a `javascript:` link is stopped at the build gate
12. the theme validator: every shipped theme passes `validate-theme.js` (token
    completeness, value safety, no JS/external resources, tiered contrast pairs,
    demo-client coverage build), the demo corpus covers the whole block registry,
    and a known-bad theme fails with named reasons
13. the editor server's request guards, probed over real HTTP: a foreign `Host`
    header and a header-less POST are refused, encoded path traversal cannot
    escape the preview/UI roots, and every response carries `nosniff` +
    `SAMEORIGIN` headers
14. the build-time image weight advisory: a >500 KB file in `img/` is named on
    stderr with its size and a one-sentence fix, a >2 MB folder gets a one-line
    total, and the build still succeeds — warnings never fail a build
15. contact-form delivery: endpoint-mode output is the previous output plus
    exactly the honeypot element (byte-level golden + a real client); netlify
    mode emits the Netlify form attributes with `formAction` optional only
    there, the `https://` guard holding everywhere else; the honeypot never
    carries an annotation; the `https://UNCONFIGURED` placeholder warns at
    build without failing it; and nothing under `extras/` is required by
    engine code
16. the maintenance ledger: every owner-handler attempt (edit, scaffold,
    approve, discard) appends one JSONL line to
    `clients/<client>/edits.log.jsonl` carrying an ISO timestamp, the
    request as submitted, the outcome, and the resolver's error verbatim
    on rejection; uploads are logged by name/size only (never file
    bytes); the file rotates at 1 MB; and an unwritable ledger never
    blocks the edit it describes

All sixteen must pass on a clean tree (`exit 0`).

---

## Directory structure

```
engine/
  build.js              Entry point — run this to build (--annotate for preview)
  apply-patch.js        Patch CLI (content + token patches)
  serve.js              Owner-editor server — click-to-edit UI (localhost)
  sitemap.js            Prints the edit map for a client to stdout
  new-client.js         Scaffolds a new client folder
  validate-blueprint.js Blueprint acceptance CLI
  validate-theme.js     Theme acceptance CLI
  blueprints-check.js   Whole-registry blueprint check + gallery regeneration
  _run-proofs.js        End-to-end proof suite (16 proofs)
  ui/                   Owner editor app: index.html, ui.js, ui.css, overlay.js
                        (overlay injected at serve time into preview pages only)
  blocks/               One module per block type (21 total)
  partials/             head, nav, footer
  lib/                  render, validate, escape, icons, patch (allowlist + token
                        guards), sitemap (edit map), annotate (preview-build
                        data-bk-* stamping), owner (editor request handlers),
                        scaffold (blueprint instantiation), bpcheck/themecheck
                        (authoring-kit pipelines)
  schema/               content.schema.json (JSON Schema draft 2020-12)

blueprints/             Developer-authored page layouts owners can instantiate
                        via the Add… menu (validated on load — see
                        BLUEPRINT_AUTHORING.md)

themes/
  default/              Full theme: tokens.json + css/styles.css + js/main.js
  <preset>/             Token presets: tokens.json only (cssBase: default)

clients/
  <name>/
    content.json        The whole site as data
    img/                Client images
    owner-config.json   Optional owner-editor config (see OPERATOR.md)
  <name>__candidate/    Working copy used by the owner editor (gitignored;
                        recreated from live on session start and on Discard)
  blueprint-gallery/    GENERATED demo client: every blueprint × variant, plus an
                        "all blocks" showcase page (visual gallery + regression
                        corpus, regenerated by npm run blueprints:check)

attic/                  Archived v3 model-tier modules (repair, patch-schema, triage,
                        AGENT_INSTRUCTIONS.md, test harness, scorecards)

extras/                 Deploy-time material the engine never imports:
  cloudflare-form-worker/  Email-Routing form endpoint (worker.js + wrangler.toml
                        example + setup README) — see OPERATOR.md "Contact form
                        delivery"

dist/                   Build output — one subfolder per client (gitignored)
  <client>/             Live build (no ids, no annotations — deployable)
  <client>__annotated/  Annotated preview build (--annotate; never deploy)
  <client>__candidate__annotated/  Owner-editor preview build (never deploy)
```

---

## Spec-silent choices (noted per SPEC.md §7)

| Question | Choice made | Reason |
|----------|-------------|--------|
| `contact-form` — `half` pairing when odd count | Last unpaired `half:true` field rendered full-width | Simplest; no data change needed |
| `service-area` without `mapEmbedUrl` | Text column fills full width | Avoids empty column |
| `page-header` without `background` | CSS default banner applies | Consistent with hero fallback |
| Block `fields` schema uses `allOf` conditionals | All `fields` validated per block type | Avoids coupling schema to type at the JSON Schema level |
| `nav` active-link detection | String comparison of href stem vs slug | Hrefs in `nav.links` are page-relative |
| Token names in patches | Accept with or without `--`; stored without (matching tokens.json keys) | The build adds `--` at injection; one canonical storage form |
| Theme assets not present in regeneration context | styles.css/main.js re-implemented token-first against every documented class | Original files were excluded from the code bundle; documented in file headers |
| `faq` accordion | Native `<details>`, no JS | Zero-dependency, accessible by default |
| `clean`/`warm` themes | Regenerated as token presets on the default CSS base | One stylesheet to maintain instead of three |
| `btn-primary-text` | Removed from SAFE_TOKENS (v3) | Live testing showed small models reach for it on "text color" requests; pair-exclusion applies |
