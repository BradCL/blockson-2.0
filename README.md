# Blockson — Static Site Engine

One engine, many client sites. A client's entire website is described by a single
`content.json` file plus a folder of images. The engine reads that file, validates it,
and emits complete, SEO-ready static HTML into `dist/`.

Blockson is built for a "set and forget" business model: a developer sets a site up
once, hands it over, and the business owner's day-to-day changes are handled by a small
local LLM that can only make safe, reversible edits. No CMS, no database, no hosting
bill beyond static files, no maintenance contract required.

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

## Two-tier maintenance model

| Tier | Who | Can do |
|------|-----|--------|
| **Setup** | Developer with full tooling | Define clients, add pages, add/remove blocks, change the engine, update CSS/JS, choose themes |
| **Maintenance** | Small local LLM (~3 B params) acting on plain-English owner requests | Edit _values_ inside `content.json`, plus a curated allowlist of brand-color theme tokens — no structural changes, ever |

The maintenance tier operates exclusively on `content.json`. It reads
`AGENT_INSTRUCTIONS.md` (copied into every client folder on build) as its operating
manual. The model is shown a compact **edit map** — not the full file — so its input
stays small as sites grow. It returns one small patch JSON object; the engine applies it
through a write-allowlist resolver and rebuilds.

Safety is layered, in code, never by trusting the model:
1. `AGENT_INSTRUCTIONS.md` — hard-stop refusals at the top of the prompt
2. `engine/lib/patch.js` — the write allowlist, the single source of truth imported by
   both the production CLI and every test harness
3. JSON Schema validation (AJV, draft 2020-12) before any file is written
4. `apply-patch.js` backs up `content.json` and restores it automatically if the
   rebuild fails — a bad patch can never leave a site broken

---

## Tokens, themes, and `themeOverrides`

Each theme is a `themes/<name>/tokens.json` — a flat map of CSS custom property names
to values (plus `cssBase` naming the stylesheet it rides on, and `googleFontsUrl`). At
build time the preset is merged with the client's optional `site.themeOverrides` map and
injected into every page as a `:root { … }` block. The shared stylesheet references
tokens via `var(--token-name)`, so one proven CSS file serves every theme.

**Selecting a preset:** set `site.theme` in `content.json` to the preset folder name.
Token-only presets declare `"cssBase": "default"` and reuse the default theme's CSS and
JS. **Building a custom theme:** copy a preset folder, change the token values, and (only
if you need structural CSS changes) add a `css/styles.css` to the theme folder — the
build prefers a theme's own CSS when present.

**Per-client tweaks** go in `site.themeOverrides` (e.g. `"color-primary": "#2D6A4F"`),
which the developer can write directly — and which the maintenance tier can now reach
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

## Running a maintenance edit

```
# See the compact edit map the model will be shown (tokens section included):
node engine/sitemap.js <client>

# Apply a patch produced by the model:
node engine/apply-patch.js <client> '<patch-json>'

# Examples:
node engine/apply-patch.js example-contractor '{"action":"set","block":"site","field":"contact.phone","value":"780-555-0142"}'
node engine/apply-patch.js example-contractor '{"action":"set-token","token":"--color-primary","value":"#2D6A4F"}'
```

The apply tool: reads `content.json` → backs it up → applies the patch through the safety
resolver → rebuilds the site. If the build fails for any reason, the original
`content.json` is restored automatically.

Patch shapes the model may emit:

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

// Change a SAFE theme token (brand colors / hero overlay only — see safeTokens in patch.js)
{ "action":"set-token", "token":"--color-primary", "value":"#2D6A4F" }

// Refuse an out-of-scope request
{ "action":"refuse", "reason":"Adding a page is structural; refer to the developer." }
```

`set-token` is the only write path into `site.themeOverrides`; values pass strict
per-type format guards (hex/named/rgb()/hsl() colors, 0–1 opacity), an injection
blacklist, and a **contrast guard** — an editable background can never be set close
enough to its theme-controlled text color to become unreadable. Plain `set` patches
targeting `themeOverrides` are rejected at the resolver.

Before the resolver, `apply-patch.js` runs a deterministic **repair pass**
(`engine/lib/repair.js`) that normalizes known small-model near-misses — e.g. a site
field name written into `block` — without granting any new capability: rewrites only
target things that provably exist, and the resolver still gates everything. For model
integrations, `engine/lib/patch-schema.js` generates a per-client JSON Schema (block,
item, and token enums) to pass as Ollama's `format`, so a grammar-constrained model
cannot emit an address that doesn't exist.

---

## Testing

```
node engine/_run-proofs.js     # or: npm test
```

Runs seven end-to-end proofs against the example clients:
1. ids never leak into rendered HTML (checked across contractor AND restaurant/v2 blocks)
2. a real field edit applies and rebuilds
3. a forbidden structural write is blocked at the resolver
4. an id-addressed item edit applies end-to-end
5. a valid `set-token` persists in `themeOverrides` and reaches the page `:root`
6. invalid `set-token` patches (bad token, bad value, plain-`set` bypass, contrast
   collision) are all rejected
7. the repair pass fixes the known near-miss shapes and never invents targets

All seven must pass on a clean tree (`exit 0`). The live-model harness
(`test-agent-map.js`) scores a local Ollama model against a client's real edit map
through the full production pipeline (schema-constrained decoding → repair → resolver →
one retry-with-error → build) and reports **safety failures** (wrong writes that passed
the resolver — ship gate: 0) separately from **helpfulness failures** (refusals/rejections,
which degrade to "email the developer"). CI runs the proof suite on every push
(`.github/workflows/ci.yml`).

---

## Directory structure

```
engine/
  build.js              Entry point — run this to build
  apply-patch.js        Production maintenance CLI (content + token patches)
  sitemap.js            Prints the edit map for a client to stdout
  new-client.js         Scaffolds a new client folder
  _run-proofs.js        End-to-end proof suite (7 proofs)
  blocks/               One module per block type (21 total)
  partials/             head, nav, footer
  lib/                  render, validate, escape, icons, patch (allowlist + token guards),
                        repair (near-miss normalizer), patch-schema (constrained decoding),
                        sitemap (edit map)
  schema/               content.schema.json (JSON Schema draft 2020-12)

themes/
  default/              Full theme: tokens.json + css/styles.css + js/main.js
  <preset>/             Token presets: tokens.json only (cssBase: default)

clients/
  <name>/
    content.json        The whole site as data
    img/                Client images
    AGENT_INSTRUCTIONS.md   Maintenance model's operating manual (overwritten on build)

dist/                   Build output — one subfolder per client (gitignored)
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
| Small-model near-misses | Deterministic repair pass before the resolver, never inside it | Repairs only rewrite to targets that provably exist; the allowlist still gates |
| `btn-primary-text` | Removed from safeTokens (v3) | Live testing showed small models reach for it on "text color" requests; pair-exclusion applies |
