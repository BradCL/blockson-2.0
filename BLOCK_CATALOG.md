# Block Catalog

The full block set: the core 12 plus the v2 additions. Every block maps to existing CSS
classes in `themes/default/css/styles.css` — block templates emit HTML using these
classes, so one stylesheet (re-colored per theme by tokens) serves every block and theme.

Conventions used below:
- **Fields** are the keys inside a block's `fields` object in `content.json`.
- `string` = plain text. `richtext` = an array of paragraph strings. `image` = a path
  relative to the client's `img/` folder. `url` = absolute or page-relative link.
  Every `href` is scheme-checked by the content schema (`https`, `http`, `mailto`,
  `tel`, `sms`, `#anchor`, or relative — `javascript:`/`data:` fail the build);
  `formAction` and `mapEmbedUrl` must be `https://` wherever they appear
  (`formAction` is required unless the contact-form block selects netlify
  delivery — see its entry).
- `?` marks an optional field. Everything else is required.
- "Repeats" means the field is an array of sub-objects, each with the listed shape.
  Every repeating sub-object carries a stable string `id` — the maintenance tier's
  addressing handle. Ids never appear in rendered HTML.
- **Maintenance** notes which fields the maintenance tier (local model) can edit through
  the patch resolver. "Most fields" = every scalar string on the block and its items.
  Adding/removing items is owner work ONLY where a blessed **item blueprint** targets
  that block type + field (shipped: card-grid cards, faq items, testimonials quotes,
  team-grid members — see BLUEPRINT_AUTHORING.md §2.5); removal is additionally
  refused on the last item. Every other array, and reordering anywhere, is
  developer-only.

A block module receives its `fields` object plus the global `site` object, and returns an
HTML string. Modules must HTML-escape all string/richtext values.

---

## Global (partials, not blocks) — driven by `site`

### nav  (`partials/nav.js`)
Fixed top navigation. Reads `site.logo.white`, `site.nav.links[]` (each `{label, href}`),
and an optional `site.nav.cta` (`{label, href}`). Marks the link matching the current
page slug as `.active`. CSS: `.nav`, `.nav-links`, `.nav-cta`, `.nav-toggle`.

### footer  (`partials/footer.js`)
Reads `site.logo.white`, `site.footer.blurb`, `site.footer.columns[]` (each
`{heading, items[]}` where an item is `{label, href?}` — no href renders as plain text),
and `site.copyright`. CSS: `.footer`, `.footer-grid`, `.footer-col`, `.footer-bottom`.

---

## Core Content Blocks

### `hero`
Full-viewport landing section. Homepage opener. One per site, typically.
- `tag` string — small uppercase eyebrow above the headline
- `headline` string
- `subhead` string
- `background` image
- `actions?` Repeats: `{label, href, style}` where `style` ∈ `primary` | `secondary`
CSS: `.hero`, `.hero-bg`, `.hero-content`, `.hero-tag`, `.hero-actions`, `.btn`.
**Theme tokens (opt-in):** `--hero-content-width`, `--header-overlay`,
`--heading-wrap`, and the `--hero-texture-image` / `--hero-texture-opacity` pair
tune the hero photo overlay, text column, and brand-texture layer — see
THEME_AUTHORING.md §2.
**Maintenance:** tag, headline, subhead editable. Background and actions developer-only
(actions carry no ids — structural by design).

### `page-header`
Sub-hero band used at the top of interior pages (about/services/gallery/contact).
- `tag` string — eyebrow
- `heading` string
- `subhead?` string
- `background?` image — defaults to the site hero image if omitted
- `variant?` string ∈ `default` | `light` — `light` uses the lighter gradient (`.about-page-bg`)
CSS: `.page-header`, `.page-header-content`, `.section-tag`.
**Theme tokens (opt-in):** `--page-header-width`, `--header-overlay`,
`--heading-wrap`, and `--hero-texture-image` / `--hero-texture-opacity` apply to
the interior-page header the same way they do to the hero — see
THEME_AUTHORING.md §2.
**Maintenance:** tag, heading, subhead editable.

### `text`
Prose region for mission/about/story content. The workhorse narrative block.
- `tag?` string — eyebrow
- `heading?` string
- `body` richtext — array of paragraphs
CSS: `.about-intro`, `.about-intro-body`, `.section-tag`.
**Maintenance:** all fields; body paragraphs edited line-by-line via text match.

### `card-grid`
A grid of repeating cards. The single most reusable block: services, features, values,
"what we do." Each card optionally carries an icon and a sub-list.
- `tag?` string — section eyebrow
- `heading?` string — section heading
- `columns?` integer ∈ 2 | 3 (default 3)
- `cards` Repeats:
  - `id` string — addressing handle
  - `icon?` string — name of an icon from the icon set (see Icons below)
  - `title` string
  - `body?` string
  - `items?` Repeats: plain strings — renders as the dashed sub-list
CSS: `.services`, `.services-grid`, `.service-card`, `.card-icon`, `.service-card-list`.
**Maintenance:** card titles/bodies/list lines editable by item id. Owners add cards
through the shipped `card-grid-card` item blueprint and remove any but the last;
reordering: developer.

### `gallery`
Filterable album grid with lightbox. Each album is a project/collection with one or more
photos; the first photo is the thumbnail.
- `tag?` string
- `heading?` string
- `filters` Repeats: `{label, value}` — the filter bar. First should be `{label:"All", value:"all"}`.
- `albums` Repeats:
  - `id` string
  - `category` string — must equal one of the `filters[].value`
  - `title` string
  - `meta?` string
  - `href?` url — optional link to the full set hosted elsewhere (e.g. a Google
    Photos / Facebook album). Renders a link on the card that opens in a new tab;
    the local images stay an on-site lightbox teaser. Use `https://UNCONFIGURED`
    as a placeholder and the build warns until it's set.
  - `linkLabel?` string — text for that link (defaults to "See all photos");
    seed it so an owner can edit the wording (e.g. "Full album on Facebook").
  - `images` Repeats: image paths (first = thumbnail)
CSS: `.gallery`, `.filter-bar`, `.filter-btn`, `.album-grid`, `.album-card` (+ `data-type`,
`data-images`, `data-title`), `.album-link`, `.gallery-empty`. JS reads the `data-*` attributes.
**Maintenance:** album titles/meta editable; the per-album `href` is click-to-edit so an
owner can repoint it if the host changes; image lists support append/delete by filename.
Filters and album add/remove: developer.

### `testimonials`
Two-column quote cards with a star row.
- `tag?` string, `heading?` string
- `quotes` Repeats: `{id, stars? 1–5 (default 5), quote, attribution}`
CSS: `.testimonials`, `.testimonials-grid`, `.testimonial-card`, `.stars`, `.attribution`.
**Maintenance:** quote text/attribution/stars editable by item id. Owners add quotes
through the shipped `testimonial-quote` item blueprint and remove any but the last.

### `list-panel`
A bordered panel containing a two-column dashed list. Hours, values, coverage,
"what's included."
- `tag?` string, `heading?` string
- `items` Repeats: plain strings
CSS: `.mission-pillars`, `.mission-card`, `.mission-list`.
**Maintenance:** all fields; lines edited/appended/deleted by exact text match.

### `service-area`
Two-column: descriptive text + dashed area list on one side, an embedded map on the other.
- `tag?` string — optional uppercase eyebrow above the heading (same `.section-tag` as card-grid/testimonials)
- `heading` string, `body?` string
- `areas` Repeats: plain strings
- `mapEmbedUrl?` url — a Google Maps embed src; omit to render text side full-width
CSS: `.service-area`, `.service-area-inner`, `.area-list`, `.area-map`.
**Maintenance:** tag/heading/body/area lines editable. mapEmbedUrl: developer.

### `contact-cards`
Two side-by-side "path" cards (e.g. "Start a project" vs "Join the team").
- `cards` Repeats: `{id, icon?, title, body?, items?[], note?, cta {label, href, style}}`
CSS: `.contact-paths`, `.contact-path-grid`, `.contact-card`, `.contact-card-list`,
`.contact-card-note`.
**Maintenance:** titles/bodies/notes/cta labels editable by item id.

### `contact-info`
A centered row of icon + label + value items (phone, email, area).
- `items` Repeats: `{id, icon?, label, value, href?}`
CSS: `.contact-info-section`, `.contact-info-bar`, `.contact-info-item`,
`.contact-info-icon`, `.contact-info-label`, `.contact-info-value`.
**Maintenance:** labels/values/hrefs editable by item id.

### `contact-form`
A contact form with a selectable, subscription-free delivery mode. Field set is
parameterized per client. The full per-host delivery story (Netlify / Cloudflare
Worker / plain endpoint) is "Contact form delivery" in [OPERATOR.md](OPERATOR.md).
- `tag?`, `heading?`, `subjectLine?`, `submitLabel?` (default "Send Message")
- `formAction` url — required in endpoint mode (must be `https://`); optional and
  not rendered in netlify mode
- `delivery?` — selects how submissions are delivered. Absent means `endpoint`:
  - `mode` ∈ `endpoint` | `netlify`
  - `formName?` string (netlify mode; default `contact`) — the form name Netlify registers
  - `successPath?` relative path (netlify mode) — rendered as the form `action` so
    Netlify redirects there after a submission; omit to use Netlify's built-in
    success page
- **endpoint mode** (default, unchanged semantics): the form POSTs to `formAction` —
  the Cloudflare Worker shipped in `extras/cloudflare-form-worker/`, or a relay
  service of your choosing.
- **netlify mode**: the form renders `name`, `data-netlify="true"`, a hidden
  `form-name` input, and `netlify-honeypot` wiring — Netlify's edge handles
  delivery; nothing to deploy.
- **Honeypot:** every form renders a visually hidden text input named `_gotcha`
  (both modes). Netlify, the Worker template, and Formspree all drop submissions
  that fill it. It is rendered markup, not schema content — it never appears in
  the edit map and carries no annotations.
- **Placeholder convention:** a `formAction` of exactly `https://UNCONFIGURED`
  means "not wired up yet". It passes the schema's `https://` guard so the site
  still builds, and every build warns loudly until it is replaced (warn, never
  fail). The contact-page blueprint's example uses it.
- `fields` Repeats: `{name, label, type ∈ text|email|tel|textarea|select, required?,
  placeholder?, options?[], half?}`
CSS: `.contact-form-section`, `.contact-form`, `.form-row`, `.form-group`,
`.form-hp`, `.btn-primary`.
**Maintenance:** tag/heading/subjectLine/submitLabel editable. Form fields and the
delivery wiring (`formAction`, `delivery.*`): developer (fields carry no ids —
structural by design).

### `cta`
Centered closing banner with a statement and a button.
- `tag?`, `statement` string, `subtext?`, `button {label, href, style}`
CSS: `.closing`, `.closing-statement`, `.closing-sub`, `.btn`.
**Maintenance:** statement/subtext/button.label editable.

---

## v2 Content Blocks

### `pricing-table`
Tiered or item-based pricing: salon service menus, fitness memberships, contractor
rates, restaurant menus. Chosen because no existing block can show a price next to a
name without abusing card-grid bodies.
- `tag?`, `heading?`, `note?` string — fine-print line under the grid
- `plans` Repeats:
  - `id` string
  - `name` string, `price` string (plain text — "$34", "from $89", "Call us")
  - `period?` string — "/month", "per visit"
  - `description?` string
  - `features?` Repeats: plain strings
  - `cta?` `{label, href, style}`
  - `featured?` boolean — visually lifts one plan (border accent)
CSS: `.pricing`, `.pricing-grid`, `.pricing-card`, `.pricing-price`, `.pricing-period`,
`.pricing-features`, `.pricing-note`.
**Maintenance:** names, prices, periods, descriptions, feature lines editable by item
id — the single most common owner request ("the short rib is $36 now"). Adding plans,
`featured`, and ctas: developer.

### `team-grid`
Staff profiles with photo, name, role, bio. Vet clinics, salons, studios, realty teams.
- `tag?`, `heading?`
- `members` Repeats: `{id, photo? image, name, role, bio?}`
CSS: `.team`, `.team-grid`, `.team-card`, `.team-photo`, `.team-role`, `.team-bio`.
A missing photo renders an initial placeholder, never a broken image.
**Maintenance:** names, roles, bios editable by item id ("Sam is now our senior
stylist"); photos replaceable through the click-to-edit image editor. Owners add
members through the shipped `team-member` item blueprint (with or without a photo)
and remove any but the last; reordering: developer.

### `faq`
Expandable Q&A pairs rendered as native `<details>`/`<summary>` — a real accordion with
zero JavaScript. list-panel cannot express question→answer pairing.
- `tag?`, `heading?`
- `items` Repeats: `{id, question, answer}`
CSS: `.faq`, `.faq-list`, `.faq-item`.
**Maintenance:** questions and answers editable by item id. Owners add pairs through
the shipped `faq-pair` item blueprint and remove any but the last.

### `hours-table`
A structured day/hours grid. Better than list-panel for businesses with per-day hours:
each row has a stable id, so "we're closed Mondays now" is one id-addressed edit, not a
fragile text match.
- `tag?`, `heading?`, `note?` string
- `rows` Repeats: `{id, day, hours}`
CSS: `.hours`, `.hours-card`, `.hours-table`, `.hours-note`.
**Maintenance:** day labels and hours editable by row id — hours changes are the #1
maintenance request for most local businesses. Adding rows: developer.

### `before-after`
Paired image comparison (renovation, salon, landscaping, detailing). Static side-by-side
pairs with Before/After badges — no slider JS to break.
- `tag?`, `heading?`
- `pairs` Repeats: `{id, title?, before image, after image, caption?}`
CSS: `.before-after`, `.ba-grid`, `.ba-pair`, `.ba-images`, `.ba-side`, `.ba-label`.
**Maintenance:** titles, captions, and the before/after images editable by item id via
the click-to-edit editor (image fields use the file picker); adding or removing pairs
is developer work.

### `stats-bar`
2–4 large numbers with labels ("14 years in business", "2,400 jobs done"). Values are
plain strings; the engine never does math on them.
- `stats` Repeats (2–4): `{id, value, label}`
CSS: `.stats-bar`, `.stats-grid`, `.stat`, `.stat-value`, `.stat-label`.
**Maintenance:** values and labels editable by item id ("we just passed 15 years").

### `process-steps`
Numbered sequential steps with optional icon ("how we work"). Numbers render from array
order — presentation only; patches still address steps by id.
- `tag?`, `heading?`
- `steps` Repeats (min 2): `{id, icon?, title, body}`
CSS: `.process`, `.process-steps`, `.process-step`, `.step-num`, `.step-icon`.
**Maintenance:** titles and bodies editable by item id. Step add/remove/reorder: developer.

### `video-embed`
One responsive embedded video with a caption. The schema restricts `videoUrl` to
YouTube/Vimeo embed endpoints — an arbitrary iframe src would be an injection surface.
- `tag?`, `heading?`
- `videoUrl` url — must match `youtube.com/embed/…`, `youtube-nocookie.com/embed/…`,
  or `player.vimeo.com/video/…`
- `caption?` string
CSS: `.video-embed`, `.video-frame`, `.video-caption`.
**Maintenance:** tag/heading/caption editable. `videoUrl`: technically reachable by the
resolver but instructed as developer-only (the model never invents URLs; the schema
pattern rejects anything that isn't a known embed host at build time).

### `booking-cta`
A prominent CTA that links OUT to a third-party booking system (Calendly, Jane,
OpenTable, Fresha). Different from `cta`: opens in a new tab with `rel="noopener"`,
names the provider, and the schema requires an `https://` external href — it signals
"this action leaves the site."
- `tag?`, `statement` string, `subtext?`, `provider?` string, `note?` string
- `button` `{label, href}` — href must be `https://…`
CSS: `.booking-cta`, `.booking-provider`, `.booking-note`, `.closing-statement`, `.btn`.
**Maintenance:** statement/subtext/provider/note/button.label editable. The booking URL:
developer-only by instruction (never invented by the model).

### `photo-strip`
A full-bleed band of finished-work photos — no titles, no filter, no lightbox.
The home-page companion to `gallery`: where `gallery` is a browsable, filterable
album grid on its own page, `photo-strip` is a flat, edge-to-edge banner of images
(typically dropped under a services overview). Modeled on the home-page strip of
the contractor site that inspired Blockson.
- `tag?`, `heading?` — optional eyebrow + heading rendered above the strip
- `photos` Repeats: `{id, image, link?, linkLabel?}` — each photo's alt text is
  derived from the site name (the same convention `gallery`/`team-grid`/
  `before-after` use). A link-less photo carries exactly one edit target: the
  picture itself. Give a photo a `link` (typically the gallery page) and the
  whole cell becomes a doorway — the photo zooms and a cue (the `linkLabel`,
  defaulting to "View gallery") fades in on hover. Three independent click-to-edit
  targets: the image (click the photo), the cue label (click the words), and the
  link URL (click the cue's arrow).
CSS: `.photo-strip`, `.photo-strip-head`, `.photo-strip-grid`, `.photo-strip-cell`,
`.photo-strip-cell--link`, `.photo-strip-img`, `.photo-strip-cue`.
**Maintenance:** tag/heading editable; each photo replaceable by item id through the
click-to-edit image picker, and an owner can set/repoint its `link`. Adding/removing
photos is developer work (no item blueprint ships for it yet).

### Evaluated and deliberately NOT included
- `announcement-banner` — a *site-wide* notice conflicts with the per-page block model;
  it would need a new partial-level data path and a dismissal cookie. Per-page notices
  are already served by `cta`/`text`. Revisit only if real clients ask repeatedly.

---

## Icons

Several blocks accept an optional `icon` name. The named SVG set lives in
`engine/lib/icons.js` (a map of name → inline SVG path markup), rendered inside the
existing `.card-icon` / `.contact-card-icon` / `.contact-info-icon` / `.step-icon`
wrappers. Current set: `hammer`, `wrench`, `home`, `paint`, `leaf`, `people`, `phone`,
`mail`, `pin`, `clock`, `star`, `check`, `calendar`, `dollar`, `heart`, `paw`, `car`,
`scissors`, `facebook`. The maintenance tier may only reference an icon name that already exists in
the set; it never adds SVGs.

---

## Extensibility Note

To add a capability later, add: (1) a new module in `engine/blocks/`, (2) its `fields`
shape to the schema (`$defs` + `allOf` entry + the `type` enum), (3) registration in
`engine/blocks/_registry.js`, (4) its entry here, and (5) any required CSS to
`themes/default/css/styles.css` using tokens for every color/radius. No existing block,
client, or content file changes. This is the only sanctioned way the engine grows.
