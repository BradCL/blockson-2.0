# Blueprint Authoring Guide

This file is the **complete contract** for authoring a Blockson blueprint from outside
this codebase. It is self-sufficient by design: everything needed to produce a valid
blueprint — the JSON schema, the full block-type catalog with every field and
constraint, the id and placeholder rules, the theme-token list, a fully worked
example, and the list of things a blueprint cannot do — is in this one document.
How you author (by hand, with an LLM, from a screenshot of a reference layout) is
irrelevant; the validator is the sole gate.

```
node engine/validate-blueprint.js my-blueprint.json   # the gate you must pass
npm run blueprints:check                              # whole registry + demo gallery
```

---

## 1. What a blueprint is

Blockson sites are one `content.json` per client, rendered by a fixed engine. Owners
edit values through a guarded patch system; they add **structure** (new pages or
blocks) only by instantiating developer-authored **blueprints** — JSON files in
`blueprints/` that describe a page or block layout, a small input form, and how the
inputs flow into content.

A blueprint may **only recombine existing block types** (the 21 in §4). That is the
Tier A boundary: blueprints and themes are community lanes gated by validators; new
block types are engine changes (Tier B, maintainer-gated — see SPEC.md §10.1).

Adding a blueprint to a deployment is dropping one `.json` file into `blueprints/`.
No code changes anywhere — the registry scans, validates, and lists it in the owner
editor's "Add…" menu automatically. Invalid files are excluded with named reasons and
can never be offered to an owner.

When an owner instantiates a blueprint, the result lands in a **candidate copy** of
their site, is rebuilt with editing annotations, and waits for an explicit Approve.
The instantiated candidate *is* the preview. Every block your blueprint creates
becomes click-to-editable through the same guarded patch path as the rest of the site.

---

## 2. The blueprint JSON schema

A blueprint is one JSON object. Validation is **strict**: an unknown key anywhere is
rejected by name (a typo like `"requried"` would otherwise silently change behavior).

```jsonc
{
  "name":    "Contact page",          // shown in the Add… menu
  "purpose": "One line on what this page is for.",
  "kind":    "page",                  // "page" | "block"
  "variants": [ ... ],                // §2.1 — at least one layout option
  "inputs":   [ ... ],                // §2.2 — the form the owner fills in
  "template": { ... }                 // §2.3 — one content fragment per variant
}
```

| Key | Rules |
|-----|-------|
| `name` | non-empty string |
| `purpose` | non-empty string; owners pick blueprints by name + purpose |
| `kind` | `"page"` (adds a page + nav entry) or `"block"` (appends one block to an existing page) |
| `variants` | non-empty array — see §2.1 |
| `inputs` | array (may be empty) — see §2.2 |
| `template` | object keyed by variant — see §2.3 |

No other keys are permitted at any level.

### 2.1 `variants`

Each variant is one layout option of the same blueprint (e.g. "with a form" vs
"details only"). At least one is required.

```json
{ "key": "withForm", "label": "Details + an enquiry form" }
```

- `key` — identifier: `^[a-zA-Z][a-zA-Z0-9_]*$`, unique within the blueprint.
- `label` — non-empty string, shown to the owner.

### 2.2 `inputs`

Each input is one field of the form the owner fills in before instantiation. Owners
type **strings**; every value is validated server-side before anything is written.

```json
{ "key": "formAction", "label": "Form endpoint URL", "type": "text",
  "required": true, "maxLength": 200,
  "pattern": "^https://",
  "hint": "a form service URL starting with https:// (e.g. from formspree.io)",
  "example": "https://formspree.io/f/your-form-id",
  "variants": ["withForm"] }
```

| Key | Rules |
|-----|-------|
| `key` | identifier (`^[a-zA-Z][a-zA-Z0-9_]*$`), unique within the blueprint |
| `label` | non-empty string — the form label and the name used in error messages |
| `type` | `text` \| `textarea` \| `image` \| `select` |
| `required` | optional boolean (default false) |
| `maxLength` | optional positive integer. **Hard ceilings apply regardless**: text 200, textarea 4000, image 200, select 100. A declared `maxLength` may only tighten these, never exceed them. Defaults when omitted: text 120, textarea 2000, image 200, select 100. |
| `pattern` | optional regex (JavaScript syntax, as a string). The value must match. |
| `hint` | optional string appended to the rejection message when `pattern` fails — write it in plain language. |
| `options` | **select only, required for select**: non-empty array of `"value"` strings or `{ "value": "...", "label": "..." }` objects. The submitted value must be one of the option values. |
| `variants` | optional array of declared variant keys — the input is active (shown and accepted) only for those variants. Omit it for inputs used by every variant. |
| `example` | optional non-empty string that must itself pass this input's constraints. **Declare one on every input that has a `pattern`** — the validator and the demo gallery instantiate your blueprint with example values, and no generic value can satisfy an arbitrary regex. Recommended on every input: examples are what reviewers and theme authors see in the gallery. |

Type-specific value rules (enforced on every submitted value and on `example`):

- `image` — must match `img/<name>.<ext>` with ext `png|jpg|jpeg|gif|webp|avif`
  (case-insensitive), `<name>` limited to `A–Z a–z 0–9 . _ -`. No directories above
  `img/`, no URLs.
- `select` — must equal one of the declared option values.
- All values are trimmed; a missing optional input becomes the empty string.
- Submitting a key that is not an active input of the chosen variant rejects the
  whole request.

### 2.3 `template`

`template` has **exactly one fragment per declared variant key** — no missing
variants, no extras.

For `kind: "page"`, a fragment is:

```jsonc
{
  "navLabel": "{{menuLabel}}",                    // becomes the nav entry AND the page slug
  "meta": { "title": "{{title}} | {{site.name}}", // <title> / OG title
            "description": "{{intro}}" },          // meta description; "ogImage" optional
  "blocks": [                                      // non-empty, rendered in order
    { "id": "header", "type": "page-header", "fields": { ... } },
    { "id": "body",   "type": "text",        "fields": { ... } }
  ]
}
```

For `kind: "block"`, a fragment is a single `{ "id", "type", "fields" }` object; at
instantiation the owner picks the target page and the block is appended to it.

Rules for each template block:

- `id` — a lowercase slug **hint**: `^[a-z][a-z0-9-]*$`, unique within the fragment.
  Final ids are generated (§3); the hint is the suffix.
- `type` — must be one of the existing block types (§4). An unknown type is rejected:
  blueprints may only recombine existing blocks.
- `fields` — an object shaped per that block type's catalog entry (§4). The full
  site build validates the instantiated result against the engine's content schema,
  so a wrong field shape fails the validator with the exact failing path.

### 2.4 Placeholders

Template **strings** (anywhere: navLabel, meta, any depth of `fields`) may carry
placeholders. Non-string values (numbers, booleans) pass through untouched and cannot
be input-driven.

| Form | Meaning |
|------|---------|
| `{{inputKey}}` | replaced with the validated input value. The input must be declared and **active in that variant** — referencing an inactive or undeclared input is a validation error. |
| `{{site.name}}` | the client's business name (builtin) |
| `{{site.contact.phone}}` | the client's phone (builtin) |
| `{{site.contact.email}}` | the client's email (builtin) |
| `{{textareaKey\|paragraphs}}` | the textarea split into an **array of paragraph strings** (blank-line separated). Must be the *entire* string value (`"body": "{{body\|paragraphs}}"`), because it changes the value's type from string to array — exactly what the `text` block's `body` field wants. |

Builtins exist so blueprints reuse the site's single source of truth instead of
asking the owner to retype their own phone number. Builtins cannot take a filter;
`|paragraphs` is the only filter.

---

## 3. Id rules

You never write final ids — you write *hints*, and the scaffolder guarantees
site-wide uniqueness deterministically:

- **Page slug**: `navLabel` (after placeholder substitution) is slugified
  (lowercase, non-alphanumerics → `-`). On collision with an existing page:
  `slug-2`, `slug-3`, … The page file is `<slug>.html` and a nav entry is added.
- **Block ids**: `<pageSlug>-<idHint>` (for `kind:"block"`: `<targetSlug>-<idHint>`),
  numeric-suffixed against every block id already in the site. Repeated
  instantiation of the same blueprint can never collide — this is proved under
  12× repetition in the proof suite.
- **Item ids** (the `id` keys on repeating objects *inside* `fields` — cards, albums,
  faq items, rows…): taken **verbatim** from your template. They must be unique
  within their block (the build rejects duplicates). They are the owner's editing
  handles, so give every repeating object a stable, readable id (`"faq-pricing"`,
  `"album-1"`).
- Ids never appear in rendered live HTML — the proof suite and the blueprint
  validator both enforce this on your instantiated output.

**Design for owner editability.** After instantiation, the owner can click-to-edit:
every scalar string field, every field of an id-carrying item, and every line of a
plain string list (which also supports add/remove line). Arrays of objects **without**
ids (`hero.actions`, `contact-form.fields`, `gallery.filters`, footer columns) are
structural — frozen after instantiation until a developer touches them. So: anything
the owner should maintain later must be a scalar, an id-carrying item, or a string
list; anything in a no-id object array is effectively hardcoded by your blueprint.

---

## 4. Block-type catalog

The complete set — a blueprint template may use these and nothing else. "Repeats"
means an array of objects, **each requiring a stable string `id`** unless noted.
Field types: `string` (plain text), `richtext` (array of paragraph strings), `image`
(path under the client's `img/`), `url`, `int`, `bool`. Optional fields are marked
`?` — everything else is required and its absence fails the build.

Every `href` is scheme-checked at the build gate: allowed forms are `https://…`,
`http://…`, `mailto:…`, `tel:…`, `sms:…`, `#anchor`, or a relative path
(`about.html`). Anything else — `javascript:`, `data:`, any unrecognized scheme —
fails the build, so it can never reach a rendered page. `formAction` and
`mapEmbedUrl` must be `https://` URLs, and `videoUrl` is restricted to the embed
hosts listed under `video-embed` below.

### Page furniture

**`hero`** — full-viewport landing section (homepage opener; one per site, typically).
- `tag` string (eyebrow above the headline), `headline` string, `subhead` string,
  `background` image
- `actions?` array of `{label, href, style: "primary"|"secondary"}` — **no ids:
  structural**, hardcode at most two

**`page-header`** — banner at the top of interior pages. The standard blueprint opener.
- `tag` string, `heading` string
- `subhead?` string, `background?` image (site hero image used if omitted),
  `variant?` `"default"` (dark band) | `"light"` (light band)

### Prose & lists

**`text`** — prose region; the workhorse narrative block.
- `body` richtext (array of paragraph strings, min 1) — pair with
  `{{input|paragraphs}}`
- `tag?` string, `heading?` string

**`list-panel`** — bordered panel with a two-column dashed list (hours, values,
"what's included").
- `items` array of strings (min 1; no ids — owners can edit/add/remove lines)
- `tag?`, `heading?` strings

**`faq`** — expandable Q&A pairs (native `<details>`, no JS).
- `items` Repeats (min 1): `{id, question, answer}` all strings
- `tag?`, `heading?` strings

### Grids & cards

**`card-grid`** — the most reusable block: services, features, values.
- `cards` Repeats (min 1): `{id, title}` + `icon?` (see §5), `body?` string,
  `items?` array of strings (dashed sub-list)
- `tag?`, `heading?` strings, `columns?` int `2`|`3` (default 3 — hardcode; inputs
  cannot produce numbers)

**`team-grid`** — staff profiles.
- `members` Repeats (min 1): `{id, name, role}` + `photo?` image (missing photo
  renders an initial placeholder, never a broken image), `bio?` string
- `tag?`, `heading?` strings

**`testimonials`** — two-column quote cards with a star row.
- `quotes` Repeats (min 1): `{id, quote, attribution}` + `stars?` int 1–5 (default 5)
- `tag?`, `heading?` strings

**`stats-bar`** — 2–4 large numbers with labels.
- `stats` Repeats (**min 2, max 4**): `{id, value, label}` — `value` is a plain
  string ("14 years"); the engine never does math on it

**`process-steps`** — numbered sequential steps ("how we work").
- `steps` Repeats (**min 2**): `{id, title, body}` + `icon?`
- `tag?`, `heading?` strings

**`pricing-table`** — tiered or item pricing (menus, memberships, rates).
- `plans` Repeats (min 1): `{id, name, price}` + `period?` ("/month"),
  `description?`, `features?` array of strings,
  `cta?` `{label, href, style: "primary"|"secondary"}`, `featured?` bool
  (visually lifts one plan — hardcode)
- `tag?`, `heading?`, `note?` (fine print) strings

### Imagery

**`gallery`** — filterable album grid with lightbox.
- `filters` array (min 1) of `{label, value}` — **no ids: structural**. First should
  be `{"label": "All", "value": "all"}`.
- `albums` Repeats (min 1): `{id, category, title, images}` + `meta?` string —
  `category` must equal one of the `filters[].value`; `images` is an array of image
  paths (min 1; first = thumbnail; owners can append/remove photos)
- `tag?`, `heading?` strings

**`before-after`** — paired image comparison with Before/After badges.
- `pairs` Repeats (min 1): `{id, before, after}` images + `title?`, `caption?` strings
- `tag?`, `heading?` strings

**`video-embed`** — one responsive embedded video.
- `videoUrl` url — **must match**
  `^https://(www.)?(youtube.com/embed/|youtube-nocookie.com/embed/|player.vimeo.com/video/)…`
  (anything else is an injection surface and fails the build)
- `tag?`, `heading?`, `caption?` strings

### Contact & conversion

**`contact-info`** — centered row of icon + label + value items.
- `items` Repeats (min 1): `{id, label, value}` + `icon?`, `href?`
  (`tel:`/`mailto:` links pair well with the §2.4 builtins)

**`contact-cards`** — two side-by-side "path" cards ("Start a project" / "Join the team").
- `cards` Repeats (min 1): `{id, title, cta: {label, href, style}}` + `icon?`,
  `body?`, `items?` array of strings, `note?` string

**`contact-form`** — a form posting to an external form service.
- `formAction` url (the service endpoint — take it as an input with
  `"pattern": "^https://"`)
- `fields` array (min 1) of
  `{name, label, type: "text"|"email"|"tel"|"textarea"|"select"}` +
  `required?` bool, `placeholder?` string, `options?` array of strings, `half?` bool
  — **no ids: structural**, hardcode the field set
- `tag?`, `heading?`, `subjectLine?`, `submitLabel?` (default "Send Message") strings

**`cta`** — centered closing banner.
- `statement` string, `button` `{label, href, style: "primary"|"secondary"}`
- `tag?`, `subtext?` strings

**`booking-cta`** — prominent CTA linking OUT to a booking system (opens a new tab,
names the provider).
- `statement` string, `button` `{label, href}` — `href` **must start `https://`**
- `tag?`, `subtext?`, `provider?` ("Calendly"), `note?` strings

---

## 5. Icons

`card-grid` cards, `contact-cards`, `contact-info` items, and `process-steps` steps
accept an optional `icon` name from the engine's built-in inline-SVG set:

`hammer` `wrench` `home` `paint` `leaf` `people` `phone` `mail` `pin` `clock`
`star` `check` `calendar` `dollar` `heart` `paw` `car` `scissors`

Blueprints may only reference these names — there is no way to add an SVG from a
blueprint.

---

## 6. Theme tokens (what you do NOT control)

Blueprints carry **zero styling** — no CSS, no classes, no inline styles. Every theme
restyles every blueprint automatically; that multiplication is the point. For
orientation, the complete token set every theme defines:

`font-heading`, `font-body` (self-contained local font stacks), `color-bg`,
`color-surface`, `color-text`, `color-muted`, `color-primary`, `color-accent`,
`btn-primary-bg`, `btn-primary-text`, `nav-bg`, `nav-text`, `footer-bg`,
`footer-text`, `hero-overlay-opacity`, `radius` (+ `cssBase`, meta).

Owners may later retune `color-primary`, `color-accent`, `btn-primary-bg`, `nav-bg`,
`footer-bg`, and `hero-overlay-opacity` through a guarded editor. None of this is
reachable from a blueprint — if your layout idea needs a new visual treatment, that
is a theme (or a Tier B block type), not a blueprint.

---

## 7. Fully worked example

A complete, valid blueprint — an FAQ page with two variants. This exact structure
passes `node engine/validate-blueprint.js`:

```json
{
  "name": "FAQ page",
  "purpose": "A page of expandable questions and answers — starts with one Q&A; add more any time.",
  "kind": "page",
  "variants": [
    { "key": "plain", "label": "Questions only" },
    { "key": "withCta", "label": "Questions, then a button inviting contact" }
  ],
  "inputs": [
    { "key": "menuLabel", "label": "Menu label", "type": "text", "required": true, "maxLength": 20,
      "example": "FAQ" },
    { "key": "title", "label": "Page heading", "type": "text", "required": true, "maxLength": 70,
      "example": "Frequently asked questions" },
    { "key": "intro", "label": "One-sentence introduction (also shown to search engines)",
      "type": "textarea", "required": true, "maxLength": 160,
      "example": "Straight answers to the questions we hear most." },
    { "key": "question", "label": "Your most-asked question", "type": "text", "required": true, "maxLength": 120,
      "example": "Do you offer free estimates?" },
    { "key": "answer", "label": "Its answer", "type": "textarea", "required": true, "maxLength": 600,
      "example": "Yes — every job starts with a free, no-obligation written estimate." },
    { "key": "ctaLabel", "label": "Button text", "type": "text", "required": true, "maxLength": 30,
      "variants": ["withCta"], "example": "Ask us directly" },
    { "key": "ctaHref", "label": "Where the button goes (a page like contact.html, or a full URL)",
      "type": "text", "required": true, "maxLength": 200,
      "variants": ["withCta"], "example": "contact.html" }
  ],
  "template": {
    "plain": {
      "navLabel": "{{menuLabel}}",
      "meta": { "title": "{{title}} | {{site.name}}", "description": "{{intro}}" },
      "blocks": [
        { "id": "header", "type": "page-header", "fields": {
          "tag": "{{menuLabel}}", "heading": "{{title}}", "subhead": "{{intro}}"
        } },
        { "id": "questions", "type": "faq", "fields": {
          "items": [
            { "id": "faq-1", "question": "{{question}}", "answer": "{{answer}}" }
          ]
        } }
      ]
    },
    "withCta": {
      "navLabel": "{{menuLabel}}",
      "meta": { "title": "{{title}} | {{site.name}}", "description": "{{intro}}" },
      "blocks": [
        { "id": "header", "type": "page-header", "fields": {
          "tag": "{{menuLabel}}", "heading": "{{title}}", "subhead": "{{intro}}"
        } },
        { "id": "questions", "type": "faq", "fields": {
          "items": [
            { "id": "faq-1", "question": "{{question}}", "answer": "{{answer}}" }
          ]
        } },
        { "id": "cta", "type": "cta", "fields": {
          "statement": "Didn't find your answer?",
          "subtext": "Call {{site.contact.phone}} or send us a message.",
          "button": { "label": "{{ctaLabel}}", "href": "{{ctaHref}}", "style": "primary" }
        } }
      ]
    }
  }
}
```

Things to notice: the `faq` item carries a hand-written `id` (`"faq-1"`) so the owner
can edit its question and answer later (appending *more* pairs stays developer work —
object items are structural); the CTA reuses `{{site.contact.phone}}` instead of
asking the owner to retype the phone number; the two variant-scoped inputs declare
`"variants": ["withCta"]`; every input has an `example`.

---

## 8. What cannot be expressed

A blueprint **cannot**:

- **Introduce a new block type**, change a renderer, or emit raw HTML. Unknown
  `type` values are rejected. New block types are Tier B (SPEC.md §10.1).
- **Carry any styling or scripting** — no CSS, classes, inline styles, or JS.
- **Reference external network resources.** Built sites are local-first: no CDN
  fonts, no remote scripts. The narrow exceptions are content the schema explicitly
  fences: `video-embed` (YouTube/Vimeo embed URLs only), `booking-cta` and
  `contact-form` endpoints (`https://` links out), `service-area.mapEmbedUrl`.
- **Touch anything outside the new page/block.** No site-level edits (name, contact,
  theme, footer), no nav reordering (the new page's nav entry is appended), no
  modification or removal of existing pages or blocks.
- **Drive non-string values from inputs.** Inputs produce strings; numbers and
  booleans (`columns`, `stars`, `featured`) must be hardcoded in the template.
- **Choose its own ids, slugs, or filenames.** Slugs and block ids are generated
  (§3); template ids are hints.
- **Exceed the hard input ceilings** (text 200 / textarea 4000 / image 200 /
  select 100 characters) no matter what `maxLength` it declares.
- **Reference images outside the client's `img/` folder**, by absolute path, by URL,
  or with a non-image extension.
- **Make repeating items owner-extensible.** Owners can edit object items and
  add/remove *string-list* lines and gallery images, but adding/removing object
  items (cards, plans, FAQ pairs) post-instantiation is developer work. Ship the
  starter set your layout needs.

If the layout in front of you needs any of these, it is not a blueprint — it is a
theme, a Tier B block-type proposal, or per-client developer work.

---

## 9. Validating and shipping

```
# One file: schema → sample instantiation of every variant into a throwaway
# client → full live + annotated build → id/annotation invariant checks.
node engine/validate-blueprint.js blueprints/faq-page.json

# Whole registry + regenerate the demo gallery (clients/blueprint-gallery/):
npm run blueprints:check
```

`blueprints:check` rewrites `clients/blueprint-gallery/content.json` — every
blueprint × every variant instantiated from its example inputs. That client is both
the **visual gallery** (build it, browse it under any theme) and the **regression
corpus**: the proof suite (`npm test`) fails if the committed gallery drifts from
regeneration, so after adding or changing a blueprint, rerun `blueprints:check` and
commit the result alongside your blueprint file.

A passing validator run plus a visual check of the gallery is the entire review bar
for the blueprint lane.
