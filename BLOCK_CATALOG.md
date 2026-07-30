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
Fixed top navigation. Reads `site.logo.white`, `site.nav.links[]` (each
`{label, href, children?}`), and an optional `site.nav.cta` (`{label, href}`). Marks the
link matching the current page slug as `.active`.
CSS: `.nav`, `.nav-links`, `.nav-cta`, `.nav-toggle`, `.nav-item`, `.nav-sub`, `.nav-caret`.

**Submenus.** A nav link may carry `children[]` (each `{label, href}`) — **one level, no
deeper** (a second level fails validation). For sites that outgrow a flat nav: eight
local-SEO service pages otherwise reach the visitor only from the footer or a hub page,
while the nav is the one element on every page. Behaviour, and why:

- **The parent stays a real link to its own page.** It is never converted into a pure
  toggle. A hub page is valuable in its own right, and where a pointer cannot hover it
  is the *only* way into the children (see below).
- **The parent reads as `.active` when the current page is any of its children.** Exact
  slug matching alone left a parent with eight children looking inactive nearly
  everywhere on the site.
- **Disclosure is CSS, not JavaScript** — `:hover` plus `:focus-within`, the same
  zero-JS spirit as the `faq` block's `<details>`. `:focus-within` is what makes it
  keyboard- and screen-reader-workable: focusing the parent reveals the children, so the
  next Tab reaches them. The hover half sits behind `@media (hover: hover)` so
  sticky-hover on a touch screen cannot pin a menu open over the page. On a touch device
  wide enough to show the horizontal bar, the parent link simply navigates to its hub.
- **Below the 640px collapse breakpoint** the children render as a plain indented list
  inside the existing overlay, always visible — nothing to hover, nothing to trap.
- `main.js` adds Escape-to-close as a progressive enhancement; with JS off the menu
  still opens, closes and is reachable.
- **A link with no `children` renders byte-identically to before** — a bare `<a>`, no
  wrapper, no caret. The caret on a parent is `aria-hidden` (decoration, never part of
  the link's accessible name).

### footer  (`partials/footer.js`)
Reads `site.logo.white`, `site.footer.blurb`, `site.footer.columns[]` (each
`{heading, items[]}` where an item is `{label, href?}` — no href renders as plain text),
and `site.copyright`. CSS: `.footer`, `.footer-grid`, `.footer-col`, `.footer-bottom`.

**Column count.** `footer.columns` is an unbounded array, and the grid now follows it:
`grid-template-columns: 2fr repeat(var(--footer-cols, 3), 1fr)` — the brand column plus
one track per column. The partial emits `--footer-cols` **only when the count is not
three**, so the common three-column footer is byte-identical to the pre-feature output
and still resolves to the historical `2fr 1fr 1fr 1fr`. A fourth column (say Services
alongside Pages / Contact / Service Area) now gets its own track instead of wrapping into
a lopsided row. Below 900px the responsive rules take over as before.

---

## Core Content Blocks

### `hero`
Full-viewport landing section. Homepage opener. One per site, typically.
- `tag` string — small uppercase eyebrow above the headline
- `headline` string
- `subhead` string
- `background` image
- `bgPosition?` string — focal point of the background, `"<x>% <y>%"` (each 0–100; default `"50% 50%"`); painted as inline `background-position` on `.hero-bg`
- `bgZoom?` number — background zoom, 1–3 (default 1); painted as inline `transform: scale()` on `.hero-bg`
- `actions?` Repeats: `{id?, label, href, style}` where `style` ∈ `primary` | `secondary`. The optional `id` makes each button an addressable, owner-editable item (see Maintenance). It is optional for backward compatibility; seed it on legacy content with `node extras/add-action-ids.js <client>`.
CSS: `.hero`, `.hero-bg`, `.hero-content`, `.hero-tag`, `.hero-actions`, `.btn`.
**Theme tokens (opt-in):** `--hero-content-width`, `--header-overlay`,
`--heading-wrap`, and the `--hero-texture-image` / `--hero-texture-opacity` pair
tune the hero photo overlay, text column, and brand-texture layer — see
THEME_AUTHORING.md §2.
**Maintenance:** tag, headline, subhead editable. Background image is owner-replaceable,
and (when `bgPosition`/`bgZoom` are seeded) its focal point + zoom are owner-editable from
the hero's image editor — guarded to bounded values in `patch.js` (a wrong value is ugly,
never broken). Buttons (`actions`) are owner-editable once each carries an `id`: clicking a
button opens the button editor (text, link, style — each its own change), and the owner can
add a button (the `cta-button` item blueprint; also offered in the Section panel when a hero
has none) or remove one (the last is refused, like any item). The link and style are gated by
the build (`safeHref` + the style enum), so a bad value is rolled back. Id-less actions stay
developer-only/structural until migrated — run `extras/add-action-ids.js`.

### `hero-form`
A hero whose call to action **is** the form: copy on one side, a short lead form on
the other, above the fold — instead of a button that makes a visitor navigate
before they can act. The layout ad traffic lands on.
- `tag`, `headline`, `subhead` string — the copy column, same fields as `hero`
- `background` image, `bgPosition?`, `bgZoom?` — identical to `hero`'s, including
  the owner-editable focal point and zoom
- `variant?` ∈ `copy-left` | `form-left` — which side the form takes **on a wide
  screen only**; absent means `copy-left`. Narrow screens always stack copy first
  (see below), so this is one decision, not two.
- `form` object **(required)** — the form spec:
  - `heading?` string — a heading above the form ("Request a quote")
  - `formAction` url — required unless `delivery.mode` is `netlify` (same rule as
    `contact-form`)
  - `delivery?`, `subjectLine?`, `submitLabel?`, `source?`, `fields` — **exactly**
    the `contact-form` shapes, because they are the same schema definitions
    (`$defs/formField`, `$defs/formDelivery`) and the same renderer
- **The form is `contact-form`'s form.** Field markup, escaping, the half-width row
  grouping, delivery modes, the honeypot and the origin tag all come from
  `engine/lib/formfields.js`, which both blocks render through — so a hero form
  and a contact-page form cannot drift apart, and there is one escaping path and
  one honeypot rather than two of each.
- **Mobile order is fixed at copy-first**, whichever side `variant` picks for
  desktop: a visitor who has just landed needs to know what the business does
  before being asked for their phone number, and the `<h1>` lives in the copy
  column. The narrow media query resets the `form-left` order deliberately.
- **A distinct block type, not an option on `hero`** (SPEC §2.6): `hero` is in
  every client and stays untouched, and the two-column layout lives inside this
  block's own markup — so nothing is needed from `lib/render.js` or
  `partials/head.js`. Each block's schema refuses the other's fields.
- **It counts as a hero for the site hero image.** Replacing a home-page `hero`
  with a `hero-form` keeps `site.heroImage`, so interior `page-header` backgrounds
  and the default `og:image` survive the swap (`engine/lib/heroimage.js`).
CSS: `.hero`, `.hero-bg`, `.hero-content`, `.hero-tag` (reused, so the photo,
overlay, texture layer and owner-editable overlay opacity all apply), plus
`.hero-form`, `.hero-form-inner`, `.hero-form-panel`, `.hero-form-heading`,
`.hero-lead-form`. The panel paints `--color-surface` so it stays readable over a
photo on light and dark themes alike.
**Maintenance:** tag/headline/subhead/`form.heading` editable; background
replaceable with focal point + zoom; `variant` offered in the Section panel as the
section's style. Form fields and delivery wiring: developer (no ids — structural).
`form.source`: developer only and unreachable from the owner tier, exactly as
`contact-form`'s is — the guard matches the leaf name, so nesting changes nothing.

### `page-header`
Sub-hero band used at the top of interior pages (about/services/gallery/contact).
- `tag` string — eyebrow
- `heading` string
- `subhead?` string — optional; when omitted there is no element to click, so the editor's Section panel offers "Add a subtitle" to create it (an owner-creatable field — see OPERATOR.md)
- `background?` image — defaults to the site hero image if omitted; an owner can set a per-page image from the editor even when it was omitted (an owner-creatable field — see "Owner-creatable fields" in OPERATOR.md), which overrides the inherited hero for that page
- `bgPosition?` string — focal point of the background, `"<x>% <y>%"` (each 0–100; default `"50% 50%"`); painted as inline `background-position` on `.page-header-bg`. Absent → the theme CSS's `background-position:center` stands. Lets the cover crop anchor on the subject so a wide/short desktop viewport doesn't behead a header photo.
- `bgZoom?` number — background zoom, 1–3 (default 1); painted as inline `transform: scale()` on `.page-header-bg`
- `variant?` string ∈ `default` | `light` — `light` uses the lighter gradient (`.about-page-bg`)
CSS: `.page-header`, `.page-header-content`, `.section-tag`.
**Theme tokens (opt-in):** `--page-header-width`, `--header-overlay`,
`--heading-wrap`, and `--hero-texture-image` / `--hero-texture-opacity` apply to
the interior-page header the same way they do to the hero — see
THEME_AUTHORING.md §2.
**Maintenance:** tag, heading, subhead editable. Background image is owner-replaceable,
and (when `bgPosition`/`bgZoom` are seeded) its focal point + zoom are owner-editable from
the same image editor as the hero's — guarded to bounded values in `patch.js` (a wrong value
is ugly, never broken). Absent focal fields leave the build byte-identical to before the
feature, so existing sites don't drift.

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
  - `link?` url — optional link to that card's own page. This is what turns a services
    overview into a services *directory*: one card per service, each pointing at the page
    about it (the shape local SEO wants). Scheme-guarded by `$defs/safeHref` like every
    other link target.
  - `linkLabel?` string — text for that link (defaults to "Learn more"); seed it so an
    owner can edit the wording.
  - `items?` Repeats: plain strings — renders as the dashed sub-list
CSS: `.services`, `.services-grid`, `.service-card`, `.service-card--link`,
`.service-card-cue`, `.service-card-cue-arrow`, `.card-icon`, `.service-card-list`,
`.sr-only`.

A linked card renders one **real, always-visible anchor** at the card's foot — not a
hit area stretched over the whole card. Two reasons, both deliberate: a card-sized
anchor takes its accessible name from everything inside it (a service card would
announce as its title + body + sub-list in one breath), and a stretched `::after`
belongs to the anchor, so in the annotated preview *every* click on the card would
resolve to the link field and the title/body/list editors would become unreachable. The
link's accessible name is the visible cue text plus a screen-reader-only `· <title>`
suffix, so four cards read "Learn more · Basement Development", "Learn more ·
Hardscaping", … instead of four identical "Learn more"s — and the visible label is a
prefix of the accessible name (WCAG 2.5.3). **A link-less card renders byte-identically
to before.**

**Maintenance:** card titles/bodies/list lines editable by item id; a card's `link` and
`linkLabel` are click-to-edit so an owner can repoint or reword the doorway (the link URL
rides the anchor, the wording rides its own span). Owners add cards through the shipped
`card-grid-card` item blueprint and remove any but the last; reordering: developer.

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
Owners add albums through the shipped `gallery-album` item blueprint (tailor its
`category` select options to this block's `filters[].value` set per client — an album
whose category matches no filter only appears under "All") and remove any but the last.
Filters themselves: developer.

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
- `source?` string — an origin tag rendered as a hidden `source` input in **both**
  delivery modes. Once a site has two forms, this is how one inbox tells them
  apart (`"home-hero"` vs `"contact-page"`), which is what a marketing company
  reads to attribute ad spend. The alternative — a different `delivery.formName`
  per form — splits them into two inboxes with two notification configs, and a
  missed notification is a missed lead. Omit it and the form is byte-identical to
  a pre-`source` build. **Developer-tier and not owner surface at all:** it is
  absent from the edit map, carries no annotation, and the resolver *and* the
  editor's read path both refuse it (`DEVELOPER_ONLY_FIELDS` in
  `engine/lib/patch.js`), because an owner who retargets it breaks attribution
  invisibly. Change it in `content.json`, where the diff shows it.
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
structural by design). `source`: developer only, and unreachable from the owner
tier by construction rather than by convention.

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
- `columns?` integer ∈ 2 | 3 | 4 | 5 | 6 (default 4) — how many photos per row
- `photos` Repeats: `{id, image, link?, linkLabel?}` — a **link-less** photo's alt text
  is derived from the site name (the same convention `gallery`/`team-grid`/
  `before-after` use) and it carries exactly one edit target: the picture itself. Give a
  photo a `link` (typically the gallery page) and the whole cell becomes a doorway — the
  photo zooms and a cue (the `linkLabel`, defaulting to "View gallery") names the
  destination. Three independent click-to-edit targets: the image (click the photo), the
  cue label (click the words), and the link URL (click the cue's arrow).
CSS: `.photo-strip`, `.photo-strip-head`, `.photo-strip-grid`, `.photo-strip-cell`,
`.photo-strip-cell--link`, `.photo-strip-img`, `.photo-strip-cue`,
`.photo-strip-cue-arrow`.

**A linked cell's accessible name is the cue text and nothing else.** The image is
decorative *inside* the link (`alt=""`), because repeating the site name on every linked
cell made four doorways announce identically with no hint of where any of them went; the
cue is exposed to assistive tech, so the owner-editable `linkLabel` is the link's name on
screen and in the accessibility tree alike; and only the arrow glyph stays `aria-hidden`.
The cue is **visible by default** and fades in on hover only under
`@media (hover: hover)` — a touch device never fires `:hover`, and the cue is the only
label there is. The zoom-and-fade animation on a hover-capable pointer is unchanged.

**Column count.** `columns` paints `--photo-strip-cols` on the *section*, which the
grid's `repeat(var(--photo-strip-cols, 4), 1fr)` reads. Absent, nothing is emitted at all
and the 4-wide default lives entirely in CSS — byte-identical to the pre-feature build.
The property rides the section rather than the grid on purpose: an inline declaration
outranks every stylesheet rule, so a value set on the grid would freeze the count at all
widths. Below 900px a strip narrows by a factor that *divides* its count, so the last row
is never left half-empty — even counts (including the default 4) halve as they always
have, 3 and 6 step to 3, and 5 stacks. Use it when a page has 2, 3, 5 or 6 photos, which
is the normal situation for a small business filling out pages incrementally.

**Maintenance:** tag/heading editable; each photo replaceable by item id through the
click-to-edit image picker, and an owner can set/repoint its `link` and reword its
`linkLabel`. Adding/removing photos is developer work (no item blueprint ships for it
yet), as is the column count.

### `reviews-link`
A styled, **capture-free** outbound social-proof badge linking to a business's
external reviews/profile page (Google today; Facebook/etc. later). It is **not** an
embed, **not** a third-party widget, **not** the Places API — no API key, no
JavaScript, no network call, no data capture. The whole badge is a single `<a href>`;
the rating and review count are **owner-maintained static text**, not live-synced. Its
honesty rests on it being a real link to the real listing, not a scraped or faked
rating. Platform-agnostic — nothing hard-codes "Google". Different from `booking-cta`
(which drives an action): this advertises existing reputation.
- `tag?`, `heading?` — optional eyebrow + heading above the badge
- `url` string **(required, `https://…`)** — the external reviews/listing link,
  validated by the same `$defs/safeHref` scheme guard the engine uses everywhere; a
  `javascript:` (or any non-https) scheme is rejected at build time.
- `platform?` string (e.g. "Google") — named in the composed label
- `rating?` string (e.g. "5.0") — omit → not rendered. A 0–5 figure with at most
  one decimal; the value guard applies wherever it is written (see Maintenance).
- `reviewCount?` string or number (e.g. "11") — omit → not rendered. A whole
  number, optionally comma-grouped ("1,204"); same guard.
- `label?` string — overrides the composed link text outright
The default label is composed from the present fields ("★ 5.0 · 11 reviews on Google
→") and gracefully degrades when `rating`/`reviewCount`/`platform` are absent (down to
"Reviews →"), always producing one valid outbound link. Opens in a new tab with
`rel="noopener noreferrer"`.
CSS: `.reviews-link-section`, `.reviews-link-heading`, `.reviews-link`,
`.reviews-link-text`, `.reviews-link-star`, `.reviews-link-rating`,
`.reviews-link-count`, `.reviews-link-platform`, `.reviews-link-label`,
`.reviews-link-arrow`.
**Maintenance:** every value is owner-editable through the ordinary `set` path —
`tag`, `heading`, `url`, `platform`, `rating`, `reviewCount`, `label`. There is **no
structural surface**: an optional field is "hidden" simply by clearing it
(the render omits empty fields), and the whole block is hidden with the standard
per-block `hidden` flag. Owners keep the rating/count honest by hand; the link itself
points at the live listing for anyone to verify.
`rating`, `reviewCount`, and `label` are also **owner-creatable** (see OPERATOR.md):
because the block renders nothing for an absent *or* cleared value, there would
otherwise be no element left to click — so clearing a stale review count would
permanently cost the owner the ability to put one back. Cleared or deleted, each
returns as an "Add a …" doorway in the Section panel. `rating` and `reviewCount`
carry a value guard on **both** paths (creating and overwriting), so the field
holds a well-formed figure or nothing at all, however the owner got there; `""`
is always accepted, because clearing is a removal rather than a bad value.

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
`scissors`, `facebook`, `stairs`, `brick`, `roof`, `fence`, `ruler`, `hardhat`, `bolt`,
`droplet`. The maintenance tier may only reference an icon name that already exists in
the set; it never adds SVGs.

The last eight are **building trades**, added because the general-business set thins
out exactly where a contractor's service pages get specific — a real eight-page build
shipped `check` for basement development and `pin` for hardscaping, approximations that
read as arbitrary next to `car` for garages. Intended use: `stairs` basement
development/renovations · `brick` hardscaping/masonry/paving · `roof` roofing ·
`fence` fencing/decks · `ruler` framing/carpentry/estimating · `hardhat` general
contracting/site work · `bolt` electrical · `droplet` plumbing. The set stays curated
rather than exhaustive; additions are purely additive, so no existing content changes.
Proof 37 checks this list against `icons.js` in both directions, so the two cannot
drift.

---

## Extensibility Note

To add a capability later, add: (1) a new module in `engine/blocks/`, (2) its `fields`
shape to the schema (`$defs` + `allOf` entry + the `type` enum), (3) registration in
`engine/blocks/_registry.js`, (4) its entry here, and (5) any required CSS to
`themes/default/css/styles.css` using tokens for every color/radius. No existing block,
client, or content file changes. This is the only sanctioned way the engine grows.
