# Contributing to Blockson

Blockson exists so a small local business can get a site once and never pay a
maintenance fee again. Every contribution is judged against that: does it keep the
engine dependency-free, the output static and local-first, and every write to an
owner's site safe by construction?

## The three lanes

Contributions arrive through three lanes with escalating strictness. In every lane,
**how you authored the contribution is irrelevant** — by hand, with an LLM, from a
screenshot of a layout you admire — the machine validator is the gate, and the same
bar applies to everyone.

| Lane | What it is | Gate | Review bar |
|------|------------|------|------------|
| **1. Themes** | `themes/<name>/tokens.json` (+ optional self-contained CSS). Pure visual design. | `node engine/validate-theme.js themes/<name>` | Validator green + a visual pass of the demo gallery under your theme |
| **2. Blueprints** | One JSON file in `blueprints/` recombining EXISTING block types into a page/block layout owners can instantiate. No CSS knowledge required. | `node engine/validate-blueprint.js blueprints/<name>.json` and `npm run blueprints:check` | Validator green + a visual pass of the regenerated gallery |
| **3. Block types** | Engine changes: a new renderer plus schema, styling, edit-map, and proof coverage. | The full checklist below | Maintainer-gated ("Tier B") |

Lanes 1 and 2 are "Tier A": community-open, and they multiply — every theme restyles
every blueprint, so one good contribution in either lane improves every site built
after it. The complete authoring contracts live in
[THEME_AUTHORING.md](THEME_AUTHORING.md) and
[BLUEPRINT_AUTHORING.md](BLUEPRINT_AUTHORING.md); each is self-sufficient by design.

**The review bar, in full:**

1. Your lane's validator passes with zero errors (it names every reason when it
   doesn't — fix what it names).
2. `npm test` is green (the proof suite runs both validators over everything
   shipped, and fails if the committed demo gallery is stale — after blueprint
   changes, rerun `npm run blueprints:check` and commit the regenerated
   `clients/blueprint-gallery/content.json` in the same PR).
3. A human looks at the demo gallery (`dist/blueprint-gallery/`, including the
   "All blocks" page) and confirms nothing is illegible, invisible, or broken.

That's the whole process. There is no style committee; if the validator and the
gallery are happy, the contribution is presumed good.

## Licensing and originality

- Contributions land under the repository's MIT license — by sending a PR you agree
  to that.
- **Copy and imagery must be original or properly licensed.** Structural
  *inspiration* from existing sites is fine (layouts, rhythm, information
  architecture are ideas); their assets and text are not (photographs, illustrations,
  fonts without a license that permits redistribution, and copied copywriting do not
  belong in this repo). Placeholder image *filenames* are the norm — never commit
  binaries you don't have rights to, and prefer committing no binaries at all.
- Fonts: themes use self-contained system stacks by default. If you ship font files
  with a theme, their license must permit redistribution (e.g. OFL) and must ride in
  the theme directory — never a CDN link (the validator rejects external resources).

## Ground rules (all lanes)

- Node.js 18+, `'use strict'`, Node stdlib only. The single sanctioned exception is
  AJV (`ajv`, `ajv-formats`) for JSON-schema validation at build time — the build
  degrades gracefully without it. Do not add dependencies.
- Local-first: nothing in themes, blueprints, the UI, or build output may reference
  an external network resource. (Schema-fenced per-client content links —
  `video-embed`, booking and form endpoints — are the deliberate exceptions.)
- All HTML output valid and accessible; every string value escaped with `esc()`.
- All styling through theme tokens (`var(--token-name)`) — no hard-coded colors in
  block CSS, no inline styles for anything a token can express.
- **The one rule: never change `engine/lib/patch.js`'s exported interface or weaken
  a guard.** `applyPatch(content, patch[, presetTokens])` plus `indexHosts`,
  `findItemById`, `SAFE_TOKENS`, `validateTokenValue`, `normalizeTokenName`,
  `TOKEN_PAIRS`, `MIN_CONTRAST`, `parseCssColor`, `contrastRatio`,
  `DANGEROUS_VALUE`. New optional parameters are acceptable; changing or removing
  existing behaviour is not. Every guard exists because of an observed failure,
  including the ones whose reason is not obvious from the code.

## Adding a block type (Tier B)

The full checklist is SPEC.md §10.1. In brief:

1. `engine/blocks/<type>.js` — exports `function(fields, site, bk) → htmlString`.
   Escape everything; thread the `bk` annotator onto every editable element;
   repeating sub-objects MUST carry a required string `id` (the edit map only
   exposes item arrays where every element has one).
2. Register it in `engine/blocks/_registry.js` (the fallback validator and the
   blueprint checker derive their type lists from the registry — no mirroring).
3. Add its `fields` shape to `engine/schema/content.schema.json`: a `$defs` entry,
   an `allOf` conditional, and the `type` enum value. Keep
   `additionalProperties: false`.
4. Add its CSS to `themes/default/css/styles.css`, colors/radii via tokens only;
   any theme shipping its own stylesheet needs coverage too.
5. Add a sample instance to `SHOWCASE_BLOCKS` in `engine/lib/bpcheck.js` — the
   theme validator fails every theme until you do (deliberate ratchet), and the
   gallery's "All blocks" page is where reviewers see your block under every theme.
6. Document it: BLOCK_CATALOG.md (including the **Maintenance** note — decide
   deliberately which fields the owner tier may edit) and the catalog section of
   BLUEPRINT_AUTHORING.md.
7. `npm test` green — proof 1 must hold with the new block in a client, and any
   new guard behavior gets its own proof.

No existing block, client file, or schema entry changes. Extend by addition only.

## Extending the `SAFE_TOKENS` allowlist

The allowlist lives at the top of `engine/lib/patch.js`. A token qualifies ONLY if
all three hold:

1. A business owner has a legitimate, recurring reason to change it (brand identity).
2. The worst possible *valid* value is ugly, never broken — it cannot collapse
   layout, hide content, or make text unreadable on its own (this is why
   text/background *pairs* are excluded: the owner may only change one side of a
   pair while the other stays theme-controlled, and the contrast guard polices the
   pair).
3. Its values are mechanically checkable by a format guard (color, opacity). A new
   value *type* means extending `validateTokenValue` with a whitelist regex and
   adding a rejection case to proof 6.

When in doubt, leave it out. A refused request costs the owner an email to the
developer; a broken site costs them customers.

## Running tests

```
npm install            # AJV — enables full schema validation
npm test               # node engine/_run-proofs.js — every proof must pass, exit 0
npm run blueprints:check   # validate all blueprints + regenerate the demo gallery
```

CI (`.github/workflows/ci.yml`) runs the proof suite on every push and PR. Don't
send a PR with a red suite.
