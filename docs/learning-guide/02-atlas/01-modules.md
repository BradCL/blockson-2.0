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
