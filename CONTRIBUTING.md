# Contributing to Blockson

Blockson exists so a small local business can get a site once and never pay a
maintenance fee again. Every contribution is judged against that: does it keep the
engine zero-runtime-dependency, the output static, and the maintenance tier safe for a
~3B-parameter local model?

## Ground rules

- Node.js 18+, `'use strict'`, no dependencies beyond AJV (`ajv`, `ajv-formats`).
- All HTML output valid and accessible; every string value escaped with `esc()`.
- All styling through theme tokens (`var(--token-name)`) — no hard-coded colors in
  block CSS, no inline styles for anything a token can express.
- **The one rule: never change `engine/lib/patch.js`'s exported interface.**
  `applyPatch(content, patch[, presetTokens]) -> { ok, action } | { ok:false, error } | { ok:false, refused, reason }`
  plus `indexHosts`, `findItemById`, `SAFE_TOKENS`, `validateTokenValue`,
  `normalizeTokenName`, `TOKEN_PAIRS`, `MIN_CONTRAST`, `parseCssColor`,
  `contrastRatio`. New optional parameters are acceptable; changing or removing
  existing behaviour is not. The production CLI and every test harness import this
  file; its behaviour is the safety contract.
- Repair rules (`engine/lib/repair.js`) may only rewrite a patch toward a target that
  provably exists in the client's content, and the result must still pass through
  `applyPatch`. A repair rule that can create a write the resolver would otherwise
  reject is a bug by definition.

## Adding a block type (the 5-step process)

1. `engine/blocks/<type>.js` — exports `function(fields, site) → htmlString`. Escape
   everything. Repeating sub-objects MUST carry a required string `id` (the edit map
   only exposes item arrays where every element has one).
2. Register it in `engine/blocks/_registry.js`.
3. Add its `fields` shape to `engine/schema/content.schema.json`: a `$defs` entry, an
   `allOf` conditional, and the `type` enum value. Keep `additionalProperties: false`.
   Mirror the type name in `engine/lib/validate.js`'s fallback `VALID_TYPES`.
4. Add its entry to `BLOCK_CATALOG.md`, including the **Maintenance** note: which
   fields the maintenance tier may edit, and which are developer-only — decide this
   deliberately, don't default to "everything".
5. Add its CSS to `themes/default/css/styles.css`, colors/radii via tokens only.

No existing block, client file, or schema entry changes. Add a worked example to one of
the `clients/example-*` files (or a new one) so the proof suite exercises it.

## Adding a theme preset

Create `themes/<name>/tokens.json` defining ALL required keys (see
`themes/README.md`): `cssBase`, `googleFontsUrl`, `font-heading`, `font-body`,
`color-bg`, `color-surface`, `color-text`, `color-muted`, `color-primary`,
`color-accent`, `btn-primary-bg`, `btn-primary-text`, `nav-bg`, `nav-text`,
`footer-bg`, `footer-text`, `hero-overlay-opacity`, `radius`. Use a real, working
Google Fonts URL. Add a design-intent section to `themes/README.md` (emotional
register, 2–3 reference points, one deliberate contrast with `default`). Check
contrast: body text on `color-bg`, `nav-text` on `nav-bg`, `btn-primary-text` on
`btn-primary-bg` should all clear WCAG AA.

## Extending the `safeTokens` allowlist

The allowlist lives at the top of `engine/lib/patch.js`. A token qualifies ONLY if all
three hold:

1. A business owner has a legitimate, recurring reason to change it (brand identity).
2. The worst possible *valid* value is ugly, never broken — it cannot collapse layout,
   hide content, or make text unreadable on its own (this is why text/background
   *pairs* are excluded: the model can only safely change one side of a pair when the
   other side is theme-controlled).
3. Its values are mechanically checkable by a format guard (color, opacity). If you
   add a new value *type*, extend `validateTokenValue` with a whitelist regex and add a
   rejection case to PROOF 6.

When in doubt, leave it out. A refused request costs the owner an email to the
developer; a broken site costs them customers.

## Running tests

```
npm install            # AJV — enables full schema validation
npm test               # node engine/_run-proofs.js — all 6 proofs must pass, exit 0
node test-agent-map.js <ollama-model> [client]   # optional: live local-model scoring
```

CI (`.github/workflows/ci.yml`) runs the proof suite on every push and PR. Don't send a
PR with a red suite. If your change alters what the maintenance model is allowed to do,
update `AGENT_INSTRUCTIONS.md` in the same PR — the instructions and the resolver must
never disagree, and when they do, the resolver is right.
