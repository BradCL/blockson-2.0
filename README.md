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
Netlify, Cloudflare Pages, an S3 bucket, etc.).

---

## Two-tier editing model

| Tier | Who | Can do |
|------|-----|--------|
| **Setup** | Developer with full tooling | Define clients, add pages, add/remove blocks, change the engine, update CSS/JS, choose themes |
| **Maintenance** | Owner (via click-to-edit UI) or a patch applied directly | Edit _values_ inside `content.json`, plus a curated allowlist of brand-color theme tokens — no structural changes, ever |

Every write, regardless of origin, passes through `applyPatch` (the write-allowlist
resolver in `engine/lib/patch.js`) and a candidate build before touching the live
site. The owner always sees a preview and issues an explicit Approve.

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

Fields, CSS classes, and per-block maintenance permissions: [BLOCK_CATALOG.md](BLOCK_CATALOG.md).

Page layouts owners can instantiate themselves are **blueprints** (`blueprints/`) —
recombinations of these block types behind a validated input form. The complete
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

The owner click-to-edit UI (in progress) needs to know, for each element on
the page, which content field it came from. An annotated build stamps every
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

## Optional model seam

The patch pipeline is the permanent seam where a copy-assist model tier could attach
in a future version. A model tier would: (1) receive the edit map from
`engine/lib/sitemap.js`, (2) produce a patch object in one of the shapes listed above,
and (3) hand it to `applyPatch` exactly as the owner UI does — with no changes to the
resolver, the guards, or the build. The archived modules in `attic/` (`repair.js`,
`patch-schema.js`, `triage.js`, and `AGENT_INSTRUCTIONS.md`) document the v3.1
approach and remain available as a reference for any future integration.

---

## Testing

```
node engine/_run-proofs.js     # or: npm test
```

Runs seven end-to-end proofs against the example clients:
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

All seven must pass on a clean tree (`exit 0`).

---

## Directory structure

```
engine/
  build.js              Entry point — run this to build
  apply-patch.js        Patch CLI (content + token patches)
  sitemap.js            Prints the edit map for a client to stdout
  new-client.js         Scaffolds a new client folder
  _run-proofs.js        End-to-end proof suite (7 proofs)
  blocks/               One module per block type (21 total)
  partials/             head, nav, footer
  lib/                  render, validate, escape, icons, patch (allowlist + token guards),
                        sitemap (edit map), annotate (preview-build data-bk-* stamping)
  schema/               content.schema.json (JSON Schema draft 2020-12)

themes/
  default/              Full theme: tokens.json + css/styles.css + js/main.js
  <preset>/             Token presets: tokens.json only (cssBase: default)

clients/
  <name>/
    content.json        The whole site as data
    img/                Client images

attic/                  Archived v3 model-tier modules (repair, patch-schema, triage,
                        AGENT_INSTRUCTIONS.md, test harness, scorecards)

dist/                   Build output — one subfolder per client (gitignored)
  <client>/             Live build (no ids, no annotations — deployable)
  <client>__annotated/  Annotated preview build (--annotate; never deploy)
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
