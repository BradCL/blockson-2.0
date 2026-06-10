# Themes — Token Preset Reference

A theme is a folder under `themes/` containing at minimum a `tokens.json`. The build
merges the preset with the client's `site.themeOverrides` and injects the result as a
`:root { … }` block into every page. All presets below declare `"cssBase": "default"` —
they ride on the single shared stylesheet (`themes/default/css/styles.css`) and shared
JS, so a theme is *only* tokens. (JSON cannot carry comments, so design intent lives
here instead of in the preset files.)

## Required token keys (every preset defines all of these)

| Key | Role | Safe-token? |
|-----|------|-------------|
| `cssBase` | Which theme's css/ to copy when this theme has none | no (meta) |
| `googleFontsUrl` | Real Google Fonts URL for the two families | no (meta) |
| `font-heading`, `font-body` | Type families | no |
| `color-bg`, `color-surface` | Page and card backgrounds | no |
| `color-text`, `color-muted` | Body and secondary text | no |
| `color-primary` | Brand color: accents, links, icons, stars | **yes** |
| `color-accent` | Secondary accent | **yes** |
| `btn-primary-bg` | Primary button fill | **yes** |
| `btn-primary-text` | Primary button label (paired with bg by the designer) | no |
| `nav-bg`, `footer-bg` | Chrome backgrounds | **yes** |
| `nav-text`, `footer-text` | Chrome text (paired with bg by the designer) | no |
| `hero-overlay-opacity` | Darkness of the photo overlay (0–1) | **yes** |
| `radius` | One corner-radius value that cascades everywhere | no |

"Safe-token" = editable by the maintenance tier via `set-token` (the allowlist lives in
`engine/lib/patch.js`). Everything else is developer-only because a wrong value can
break readability or layout, not just taste. Editable backgrounds are additionally
protected by a contrast guard: a `set-token` value too close to its theme-controlled
counterpart (e.g. `btn-primary-bg` vs `btn-primary-text`) is rejected at the resolver.

## The presets

### `default` — contractor / general (dark, bold)
Emotional register: capable, solid, after-hours-jobsite confidence. References: tool
brand sites, matte-black truck wraps, amber work lights. Amber `#ffb703` on charcoal,
Outfit headings. This is the baseline every other preset deliberately contrasts with.

### `clean` — general / professional (light, blue)
Calm, competent, office-hours. References: accounting suites, dental sites, SaaS
landing pages. Blue `#2563eb` on near-white; contrast with default: light instead of
dark, cool instead of warm.

### `warm` — general / friendly (cream, orange)
Approachable, family-run. References: bakery branding, craft-market signage. Orange
`#e76f2c` on cream, rounded 14px radii; contrast with default: soft and sunlit instead
of bold and dark.

### `restaurant` — casual dining / café
Candlelit but casual: terracotta `#9c4722` + honey `#c98a2d` on warm cream, Fraunces
serif headings. References: wood-fired menus, butcher paper, natural-wine lists.
Contrast with default: serif warmth and food-photo-first light surfaces instead of
industrial dark.

### `auto` — auto repair / tire shop
Garage-floor industrial: safety orange `#ff6b1a` + steel blue on gunmetal, Barlow
Condensed headings. References: tire brands, racing liveries, tool chests. Contrast
with default: tighter 6px radii and condensed type — harder-edged than the contractor
theme it must never be mistaken for.

### `salon` — hair / beauty / spa
Soft-focus editorial: dusty rose `#b46a7d` + champagne gold on blush, Cormorant
Garamond display serifs, generous 18px radii. References: boutique skincare packaging,
bridal editorial, brass fixtures. Contrast with default: the most delicate preset —
thin serifs where default is heavy sans.

### `fitness` — gym / yoga studio
High-voltage: electric lime `#c6f432` on near-black, Archivo headings. References:
class-pass apps, night-run gear, neon signage. Contrast with default: same dark family
but acid-bright instead of amber-warm — energy, not solidity.

### `landscape` — landscaping / lawn care
Overcast-garden natural: leaf green `#3e7c3a` + ochre `#b58836` on sage-tinted white,
Merriweather serif headings. References: seed packets, parks signage, field guides.
Contrast with default: organic and daylit instead of nocturnal-industrial.

### `vet` — veterinary clinic / grooming
Gentle and clinical-but-kind: teal `#1f8a8c` + warm orange `#f4a259` on minty white,
Quicksand's rounded geometry. References: pediatric clinics, pet-food rebrands.
Contrast with default: trust through softness rather than strength.

### `realty` — real estate / property management
Premium print: navy `#1b2f55` + brushed gold `#b8924a` on white, Playfair Display
headings, sharp 4px radii. References: listing brochures, bank lobbies, serif logos on
for-sale signs. Contrast with default: the most formal preset — crisp white space where
default is dense and dark.

### `childcare` — daycare / early learning
Storybook-bright: coral `#f25f5c` + teal `#2ec4b6` on warm cream, Baloo 2's chubby
rounds, the biggest radii in the set (22px). References: picture-book covers, wooden
toys, kindergarten wayfinding. Contrast with default: playful maximum-roundness versus
default's squared confidence.

### `trades` — plumbing / HVAC / electrical
Dependable daylight service: bright blue `#0e5fd8` + safety yellow `#ffc224` on light
steel, IBM Plex (condensed headings). References: van wraps, safety signage, utility
bills done well. Contrast with default (the *other* trades-adjacent theme): light and
dispatch-fast instead of dark and craftsman-heavy — distinct on purpose.

### `events` — event / wedding venue
After-dark romance: champagne `#d4af7a` + soft violet on deep plum `#171120`, Marcellus
small-caps-feel headings. References: wedding invitations, theatre programmes, string
lights. Contrast with default: dark like default but jewel-toned and ceremonial, not
industrial.

## Adding a preset

Copy any preset folder, rename it, change the values, keep every required key, and add
its design intent here. If the new vertical needs structural CSS (not just colors), give
the theme its own `css/styles.css` — the build prefers a theme's own CSS when present.
