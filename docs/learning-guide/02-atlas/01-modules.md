# Atlas 01 — Modules, `require`, and `module.exports`

## In class you learned…

That code is organized into files, each file can export functions or
objects, and other files import them. In Node.js the classic form is
CommonJS: `module.exports = { thing }` to publish, and
`const { thing } = require('./file')` to consume. (You may have also seen
the newer `import`/`export` syntax — Blockson uses CommonJS throughout.)

## In Blockson it lives at…

- Every file under `engine/lib/` ends with a `module.exports = { … }`
  statement — look at the bottom of `engine/lib/patch.js`,
  `engine/lib/escape.js`, `engine/lib/owner.js`.
- `engine/blocks/_registry.js` is a module whose *entire job* is to
  require other modules and re-export them as one lookup table.
- `engine/lib/render.js` shows the consumer side: it requires partials,
  the registry, and `annotate.js` in its first seven lines.

## A guided read-through

`engine/blocks/_registry.js`, in full spirit (excerpted):

```js
module.exports = {
  // Core 12
  'hero':          require('./hero'),
  'page-header':   require('./page-header'),
  ...
  'booking-cta':   require('./booking-cta'),
};
```

Each `require('./hero')` returns whatever `hero.js` exported — and each
block file exports exactly one function:

```js
// engine/blocks/hero.js
module.exports = function hero(fields, site, bk) { ... };
```

So the registry is an object mapping a *string* (the `type` a block
declares in `content.json`) to a *function* (the renderer for that type).
`engine/lib/render.js` then does the dispatch:

```js
const BLOCKS = require('../blocks/_registry');
...
const mod = BLOCKS[block.type];
if (!mod) throw new Error(`Unknown block type "${block.type}" ...`);
let html = mod(block.fields, site, bk);
```

Read that middle line again: `BLOCKS[block.type]` is data (a string from a
JSON file) selecting code (a module's exported function). That's the
module system being used as a **plugin registry** — adding a 22nd block
type means writing one new file and adding one `require` line; nothing
else in the engine changes.

> **Term: registry.** A central table that maps names to implementations,
> so the rest of the program can look things up instead of hard-coding
> `if (type === 'hero') … else if (type === 'cta') …` chains.

## What production adds

Three habits the classroom version rarely mentions:

1. **One module, one responsibility, stated in a header comment.** Open
   any `engine/lib/` file: the first thing you see is a block comment
   saying what the module is, what guarantees it makes, and who calls it.
   `patch.js` opens with "The single source of truth for how a
   maintenance-tier patch is applied… Both the production apply tool and
   the test harness import this, so they can never diverge." That last
   clause is the production insight: **sharing a module is how you prevent
   two copies of a rule from drifting apart.**
2. **Deliberate export surface.** `patch.js` exports not just `applyPatch`
   but also `SAFE_TOKENS`, `DANGEROUS_VALUE`, `contrastRatio`… each with a
   reason (the comment beside `DANGEROUS_VALUE` explains it's exported "so
   the theme validator applies the SAME injection blacklist"). What a
   module *doesn't* export is private by convention — Node won't stop you,
   but the export list documents intent.
3. **`'use strict';` at the top of every file.** It makes JavaScript throw
   on a class of silent mistakes (assigning to undeclared variables,
   duplicate parameters). Free safety; every file here takes it.

Also notice what's *absent*: no framework, no build step for the engine
itself, no `import` transpilation. The engine is plain Node files
requiring each other — a production system does not have to be a
complicated one.

## Why here, why this way

The registry pattern exists because of the schema contract: `content.json`
names block types as strings, so somewhere a string must become a
function. Putting that mapping in one file means the validator can derive
the list of legal types from the same place —
`engine/lib/validate.js` does exactly that in its fallback path:

```js
const VALID_TYPES = new Set(Object.keys(require('../blocks/_registry')));
```

One module is the source of truth for "what block types exist," and both
the renderer and the validator consume it. When you find yourself writing
the same list in two files, reach for this move.

---

## Try it

*Set up once for all exercises in this guide:*
`node engine/new-client.js learning-lab` *then*
`node engine/build.js learning-lab`. *Everything hands-on happens in
`clients/learning-lab/` — never in `engine/` or the example clients.*

**Exercise 1 (predict, then verify).** The registry maps type strings to
renderer functions. *Question:* if `content.json` names a type that isn't
in the registry — say `"banner"` — which layer catches it: the registry
lookup in `render.js`, or something earlier? **Write down your
prediction.** Then edit `clients/learning-lab/content.json`, change the
hero block's `"type"` to `"banner"`, and run
`node engine/build.js learning-lab`.

<details><summary>What you should see</summary>

Validation fails *before* rendering ever starts:

```
Validation failed:
  ✗ pages.0.blocks.0.type must be one of: hero, page-header, text, ...
```

The schema's `enum` of types is checked by ajv, so the `throw` in
`renderPage` for unknown types is a second line of defense that normally
never fires. (Change the type back and rebuild before moving on.)
</details>

**Exercise 2 (modification, safe).** Print the registry without the
engine's help:
`node -e "console.log(Object.keys(require('./engine/blocks/_registry')))"`.
Count them — there should be 21, and the list should match the error
message from Exercise 1. Two consumers, one source of truth.

## Self-check

1. What does `require('./hero')` actually return, given how `hero.js`
   ends?
   <details><summary>Answer</summary>Whatever was assigned to
   `module.exports` — here a single function `hero(fields, site, bk)`
   that returns an HTML string.</details>
2. Why do both `render.js` and `validate.js` read the block list from
   `_registry.js` instead of keeping their own?
   <details><summary>Answer</summary>So the set of renderable types and
   the set of valid types can never drift apart — one module is the
   single source of truth, and both consumers derive from it.</details>
3. Transfer: you're adding a `coupon-banner` block type. Which files
   change?
   <details><summary>Answer</summary>A new
   `engine/blocks/coupon-banner.js`, one `require` line in
   `_registry.js`, the type enum + fields rules in
   `engine/schema/content.schema.json`, and documentation in
   BLOCK_CATALOG.md. Nothing in `render.js` — that's the registry
   pattern paying off.</details>
4. Why does `patch.js` export `DANGEROUS_VALUE` when `applyPatch` already
   uses it internally?
   <details><summary>Answer</summary>So the theme validator can apply
   the *same* injection blacklist to preset token values that the
   resolver applies to owner values — sharing the constant prevents the
   two rules from diverging. The comment beside the export says
   so.</details>
