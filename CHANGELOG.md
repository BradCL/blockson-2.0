# Changelog

All notable changes to Blockson are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/): breaking
changes to the `content.json` schema, the patch contract, or theme tokens bump
the major version.

## [Unreleased]

### Added
- **contact-form `source` tag** (optional, developer-tier): a hidden `source`
  input rendered in both delivery modes, so two forms on one site can share a
  single inbox and still be told apart — the attribution a marketing company
  reads. Omit it and the form is byte-identical to a pre-`source` build.
- **`DEVELOPER_ONLY_FIELDS`** in `engine/lib/patch.js`: a new, narrow class of
  block field that is rendered markup *configuration* rather than owner content.
  Refused by the resolver for every action (field and dotted paths), omitted from
  the edit map, and refused by the editor's read path — so it cannot be shown,
  described, or written from the owner tier. `contact-form.source` is the only
  member today.
- **reviews-link `rating` / `reviewCount` / `label` are owner-creatable.** The
  block already degraded gracefully as each went absent, but the owner could not
  add one back, so "take the stale review count out" was a one-way door that cost
  a developer callout to reopen. Each now returns as an "Add a …" doorway.

### Changed
- **A cleared optional value now counts as omitted** in the edit map, for any
  creatable field whose block renders nothing when it is blank. Previously a
  cleared field stayed an ordinary scalar with no rendered element — unclickable,
  with no doorway either, and (in a client whose proofs check annotation
  coverage) demanding an annotation no block emits. Also fixes this for a cleared
  `page-header` subtitle. A field that still renders when empty (an inheriting
  `page-header` background) is unaffected.
- **`rating` and `reviewCount` are shape-guarded on overwrite, not just on
  creation** (`FIELD_FORMATS`): a rating is a 0–5 figure with at most one decimal,
  a count is a whole number optionally comma-grouped, and `""` is always accepted
  because clearing is a removal rather than a bad value. Every value in the
  shipped clients already conforms, and a numeric `reviewCount` stays numeric.
- **A refused creatable value now explains itself.** A guard failure reported
  "field does not exist", which was true of the field but said nothing about the
  value typed; descriptors carry a plain-language `hint` instead.

- **`hero-form` block type** (the 24th): a hero whose call to action *is* the
  form — copy on one side, a short lead form on the other, above the fold,
  instead of a button that makes a visitor navigate before they can act. It
  renders **the same form as `contact-form`**, through a new shared renderer
  (`engine/lib/formfields.js`), so both share one escaping path, one honeypot,
  one delivery contract and one origin tag. A distinct block type rather than an
  option on `hero` (SPEC §2.6): `hero` and `heroFields` are untouched, and the
  two-column layout lives in the new block's own markup, so nothing was needed
  from `lib/render.js` or `partials/head.js`. Narrow screens always read
  copy-first, whichever side `variant` gives the form on a wide one.
- Schema surface: `heroFormFields` plus `$defs/leadForm`. The `contact-form`
  field and delivery shapes moved to `$defs/formField` / `$defs/formDelivery`,
  shared by both blocks — a like-for-like extraction with no change to what
  validates.

### Documentation
- **SPEC §2 principle 5 now describes the engine that exists.** It claimed the
  deployed site has "no tracking — and no external resources," stated absolutely,
  while `service-area` has always rendered a third-party map frame and
  `contact-form` has always posted to a third-party endpoint. The principle is now
  three separate rules: the engine adds nothing of its own, themes may contain
  nothing (machine-enforced), and **content may reference a third party where a
  developer puts one there** — fenced by the schema and visible in a diff. The
  property protected is that nothing reaches out unless a developer wrote it into
  `content.json`; the owner tier can never create such a field. This records a
  decision, not a change: no code behaviour was altered, and
  BLUEPRINT_AUTHORING.md §8 already documented the exceptions this way.
- The same section now states why two embed fields carry different guards: the
  **scheme** check is the security boundary (`javascript:`/`data:` in an
  `iframe src`) and everything is `esc()`d into a quoted attribute regardless,
  while a **host** allowlist is a typo-catcher for a field that means one specific
  thing. `video-embed`'s comment claimed the host allowlist was what made an
  iframe safe; corrected.

### Fixed
- **Replacing a home-page `hero` with another hero-style block no longer loses
  the site hero image.** `findSiteHeroImage` matched the literal type name in
  three separate copies (`build.js`, `lib/owner.js`, `lib/host-browser.js`), so a
  swap would silently have taken every interior `page-header` background and the
  default `og:image` with it. The three copies are now one module
  (`engine/lib/heroimage.js`) with the eligible block types named once.
- **A developer-only field nested inside an object is now omitted from the edit
  map**, not just a top-level one. `applyPatch` already refused it on the leaf
  name, so the resolver and the map disagreed about a field that merely sat one
  level down (`form.source`).

### Notes for vendored client repos
- All three additions touch the **edit map's shape**, so a client repo with proofs or
  blueprints keyed to it should re-run its own suite: block descriptors may now
  carry `creatable` entries for `reviews-link`, and a `contact-form` that sets
  `source` will have that field absent from its descriptor. No existing key
  changes meaning and no field is removed from any client that does not opt in.
- Schema surface added: `contactFormFields.source`, `heroFormFields`,
  `$defs/leadForm`, `$defs/formField`, `$defs/formDelivery`. Additive and
  optional — every existing `content.json` validates unchanged, and all 77 built
  pages across the example clients, the blueprint gallery and a live client were
  verified byte-identical through the `contact-form` extraction.
- A client adopting `hero-form` must carry the **stylesheet** across too: the new
  block's classes live in `themes/default/css/styles.css`. A vendored engine
  checkout that pins its own theme CSS will render the block unstyled until the
  theme is synced (the theme validator names this — it refuses a theme that
  styles no class of a registered block type).
- Nothing in these changes touches `.gitignore` or `.github/`, the two
  client-owned trees that are hand-mirrored rather than path-checked-out.

## [2.0.0] — 2026-07-02

First public release. Blockson 2.0 is a ground-up rebuild of a private
predecessor; everything below is new in this line.

### Engine
- One engine, many client sites: each site is a single `content.json` plus an
  image folder, validated against a JSON schema (AJV, with a reduced built-in
  fallback validator when AJV is absent) and rendered to SEO-ready static HTML —
  sitemap, robots.txt, canonical/OpenGraph tags included.
- 23 block types across core and v2 sets, documented in `BLOCK_CATALOG.md`.
- Themes as token files (`themes/`), with authoring guides for themes and
  blueprints.

### Two-tier editing
- **Setup tier** (developer): full engine, block, theme, and blueprint control.
- **Maintenance tier** (owner): every write flows through `applyPatch`
  (`engine/lib/patch.js`), a deterministic allowlist resolver that makes unsafe
  edits unrepresentable — values, visibility, curated brand tokens, and
  developer-blessed blueprint instantiation only.
- Click-to-edit owner editor (`engine/serve.js`) with candidate preview,
  keep/discard sessions, one-button Publish with git-backed restore points,
  image upload with compression and thumbnails, and an optional on-device AI
  help assistant.
- No-install browser demo (`npm run build:demo`) running the same editor on an
  in-browser host.

### Trust mechanisms
- End-to-end proof suite (`npm test`) — every safety claim in `SPEC.md` is
  backed by a proof; the suite is the quality gate for every change.
- Browser smoke tests for the overlay, the editor keep-open flow, and the demo.
- CI across three Node versions.

### Handover
- Owner launcher app plus a single-executable runtime build (`npm run
  build:exe`) so an owner machine needs no Node install.
- Operator runbook (`OPERATOR.md`), handover kit (`docs/handover/`), learning
  guide, and captured developer/owner tutorials.

[Unreleased]: https://github.com/BradCL/blockson-2.0/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/BradCL/blockson-2.0/releases/tag/v2.0.0
