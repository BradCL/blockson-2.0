# Theme Authoring Guide

This file is the complete contract for contributing a Blockson theme. How you author
it is irrelevant — the validator is the sole gate:

```
node engine/validate-theme.js <theme-dir>     # the gate you must pass
```

A theme restyles **every** site the engine can build: all 21 block types, every
blueprint, every client. That multiplication is the value of the lane — and the
reason the contract below is strict.

---

## 1. What a theme is

A directory containing, at minimum, a `tokens.json`. Two shapes:

- **Token preset** (the common case — 12 of the 13 shipped themes): `tokens.json`
  only, declaring `"cssBase": "default"`. Your theme rides the shared, proven
  stylesheet and is *only* design decisions: colors, type stacks, radius, overlay.
- **Full theme**: `tokens.json` plus your own `css/styles.css`. Required only when
  the design needs structural CSS the shared stylesheet cannot express. Your
  stylesheet must then cover every block type (§4).

At build time the preset is merged with the client's `site.themeOverrides` and
injected into every page as a `:root { … }` block; the shared stylesheet resolves
every color, font, and radius through `var(--token-name)`.

## 2. Required token set

The required keys are, by definition, **the keys of `themes/default/tokens.json`** —
the worked example is the contract, and the validator derives the list from it
(no separate list to drift). Currently:

| Key | Role | Owner-editable? |
|-----|------|-----------------|
| `font-heading`, `font-body` | Type stacks — **self-contained** (§3) | no |
| `color-bg`, `color-surface` | Page and card backgrounds | no |
| `color-text`, `color-muted` | Body and secondary text | no |
| `color-primary` | Brand color: accents, links, icons, stars | **yes** |
| `color-accent` | Secondary accent | **yes** |
| `btn-primary-bg` | Primary button fill | **yes** |
| `btn-primary-text` | Primary button label | no |
| `nav-bg`, `footer-bg` | Chrome backgrounds | **yes** |
| `nav-text`, `footer-text` | Chrome text | no |
| `hero-overlay-opacity` | Photo-overlay darkness, 0–1 | **yes** |
| `radius` | One corner radius that cascades everywhere | no |
| `cssBase` | Meta: whose CSS to ride (required unless you ship `css/styles.css`) | no |

"Owner-editable" = in the `SAFE_TOKENS` allowlist (`engine/lib/patch.js`): business
owners can later retune these through a guarded editor, with format and contrast
guards running live. Two consequences for you:

- Every token **value** must pass the same injection blacklist that guards owner
  edits (no `;`, `{`, `}`, `<`, `>`, `url(`, comments, or escapes — preset values
  land in the injected `:root` block exactly like owner overrides do).
- The six owner-editable tokens must be valid for their type (color / opacity
  formats) from the start — owners build on top of your values.

Extra keys beyond the required set are allowed (e.g. custom tokens your own CSS
consumes) but get the same value-safety checks.

## 3. Hard rules

Non-negotiable; each is checked mechanically:

- **No JavaScript.** Themes are CSS + tokens — pure visual design. (The engine's
  shared interactive JS lives in `themes/default/js/` and is engine code, copied
  into every build regardless of theme; it is not theme surface.)
- **No external or network resources.** Built sites are local-first: no CDN fonts,
  no remote stylesheets or images, no protocol-relative URLs, no `@import`. Font
  tokens are stacks of locally-available faces; a theme that needs a specific face
  ships the font files inside its own `css/` and `@font-face`s them.
- **Self-contained assets.** Everything the theme needs lives in the theme
  directory. One stylesheet, no `@import` chains.

## 4. Block-type coverage

Your theme must style every block type the engine renders. The validator builds the
demo gallery client (`clients/blueprint-gallery/` — every blueprint × variant plus
an "All blocks" showcase page containing one instance of all 21 block types) under
your theme; the build must succeed.

- **Token presets** inherit full coverage from their `cssBase` stylesheet — the
  build check is the whole test, and your real work is judged visually (§6).
- **Full themes** are additionally checked class-by-class: for each block type, at
  least one block-specific class from the renderer's real output must appear in
  your stylesheet (which hook you style is your choice — the default theme styles
  `.about-intro-body` rather than `.about-intro`). The complete class list per
  block is documented in BLOCK_CATALOG.md. Styling one class per block is the
  *floor*, not the goal — browse the gallery and cover what you see.

## 5. Contrast pairs

Every pair below is checked with the engine's own WCAG-relative-luminance math
(`engine/lib/patch.js`). Thresholds are tiered by what the pair renders:

| Foreground | Background | Minimum | Why |
|------------|------------|---------|-----|
| `color-text` | `color-bg` | 4.5 | body text, WCAG AA |
| `color-text` | `color-surface` | 4.5 | card text, WCAG AA |
| `nav-text` | `nav-bg` | 4.5 | navigation labels |
| `footer-text` | `footer-bg` | 4.5 | footer text |
| `btn-primary-text` | `btn-primary-bg` | 3.0 | large/bold button label |
| `color-muted` | `color-bg` | 3.0 | secondary text, deliberately soft |
| `color-primary` | `color-bg` | 1.5 | brand floor — same as the owner-edit guard |
| `color-accent` | `color-bg` | 1.5 | brand floor — same as the owner-edit guard |

The 1.5 brand floor matters beyond aesthetics: the owner editor refuses any
`set-token` value below it, so a preset shipping a lower-contrast brand color would
ship a value the engine itself would refuse an owner. (This was real: the `trades`
preset's original safety yellow sat at 1.48 and was deepened one step in v4.)

Unparseable color values (exotic formats) produce a warning and skip the check —
prefer `#rrggbb` so every pair is actually verified.

## 6. Worked example: the default theme

`themes/default/` is the canonical example of both shapes at once — it ships the
shared stylesheet every preset rides, and its `tokens.json` defines the required
key set:

```json
{
  "cssBase": "default",
  "font-heading": "'Outfit', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
  "font-body": "'DM Sans', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
  "color-bg": "#0f1115",
  "color-surface": "#181b22",
  "color-text": "#f2f3f5",
  "color-muted": "#9aa1ab",
  "color-primary": "#ffb703",
  "color-accent": "#fb8500",
  "btn-primary-bg": "#ffb703",
  "btn-primary-text": "#14161a",
  "nav-bg": "#0f1115",
  "nav-text": "#f2f3f5",
  "footer-bg": "#0b0d10",
  "footer-text": "#9aa1ab",
  "hero-overlay-opacity": "0.55",
  "radius": "10px"
}
```

Reading it as a designer: dark charcoal surfaces (`color-bg`/`color-surface` two
steps apart, so cards read as cards), near-white text comfortably past 4.5, a muted
gray for secondary copy, amber as the single brand color reused for the button fill
with a near-black label, chrome matching the page background, a slightly darker
footer, a 0.55 overlay so white hero text survives any photo, and one 10px radius
everywhere. The signature face (`Outfit`) leads each font stack; the stack behind
it keeps the design self-contained when that face isn't available.

The design *intent* of every shipped preset — emotional register, references, and
each one's deliberate contrast with `default` — lives in
[themes/README.md](themes/README.md). Add a section for yours there in the same PR.

## 7. Authoring workflow

1. Copy the closest shipped preset folder and rename it (lowercase, hyphens).
2. Change the values. Keep every required key. Mind the contrast table.
3. Validate: `node engine/validate-theme.js themes/<name>` — fix anything it names.
4. Look at it: `node engine/build.js blueprint-gallery` after setting the gallery's
   `site.theme` to your preset locally — or validate any example client with your
   theme — and browse `dist/`. The "All blocks" page shows every block type at
   once; check nothing is illegible or invisible.
5. Add your design-intent section to `themes/README.md`.
6. `npm test` must stay green (the proof suite validates every shipped theme).

Validator green + a visual pass of the gallery is the entire review bar — see
CONTRIBUTING.md for lane rules, licensing, and originality requirements.
