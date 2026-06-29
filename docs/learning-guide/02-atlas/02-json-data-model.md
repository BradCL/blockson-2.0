# Atlas 02 — JSON as a data model

## In class you learned…

That JSON is a text format for structured data — objects, arrays, strings,
numbers, booleans — and that `JSON.parse` and `JSON.stringify` convert
between text and live JavaScript values. Typically you used it to pass
small payloads to and from an API.

## In Blockson it lives at…

JSON is not a payload here — it is the **entire data tier**. Four kinds of
file, four different jobs:

| File | Role |
|---|---|
| `clients/<name>/content.json` | a whole website as one document |
| `themes/<name>/tokens.json` | a flat map of CSS design tokens |
| `blueprints/*.json` | templates for structure owners may add |
| `clients/<name>/edits.log.jsonl` | an append-only event log (note the `l`) |

The code that treats content as a queryable database lives in
`engine/lib/patch.js` (`indexHosts`, `findItemById`, `resolveField`) and
`engine/lib/sitemap.js` (`buildEditMap`).

## A guided read-through

Open `clients/example-contractor/content.json`. The shape is:

```json
{
  "site":  { "name": "...", "baseUrl": "...", "theme": "default",
             "nav": { "links": [ ... ] }, "contact": { ... } },
  "pages": [
    { "slug": "index",
      "meta": { "title": "...", "description": "..." },
      "blocks": [
        { "id": "home-hero", "type": "hero", "fields": { ... } },
        ...
      ] }
  ]
}
```

Three modelling decisions to notice:

1. **Everything addressable carries an `id`.** Blocks have ids; repeating
   items inside blocks (cards, FAQ pairs, team members, hero CTA buttons)
   have ids. Patches
   say `"block": "home-hero"`, never "the second block on page one."
   `engine/build.js` enforces uniqueness site-wide
   (`checkBlockIdUniqueness`, `checkItemIdUniqueness`) precisely because
   ids are the addressing scheme. Array *positions* are not stable — an
   id survives reordering; index 2 does not.
2. **`type` selects code; `fields` is data for that code.** The block
   object is a tagged union: the `type` string picks a renderer from the
   registry (atlas 01), and `fields` is that renderer's input.
3. **Separation of content and presentation.** `content.json` never
   contains a color or a font; those live in `themes/<name>/tokens.json`
   as a flat name → value map, merged with the client's
   `site.themeOverrides` at build time (`engine/build.js`, the
   `resolvedTokens` spread: `{ ...preset, ...(site.themeOverrides || {}) }`).
   Note the order — overrides last, so the client wins.

Now look at how code *queries* this document.
`engine/lib/patch.js`:

```js
function indexHosts(content) {
  const map = new Map();
  if (content && content.site) map.set('site', content.site);
  for (const page of (content && content.pages) || []) {
    for (const block of (page && page.blocks) || []) {
      if (block && typeof block.id === 'string') map.set(block.id, block.fields || {});
    }
  }
  return map;
}
```

This flattens the page tree into a `Map` keyed by block id — building an
*index*, exactly like a database would, so lookups are by identity rather
than by walking the tree each time. `findItemById` in the same file does
the recursive walk for nested items, and `resolveField` walks a dotted
path like `"contact.phone"` down to `{ parent, key }` so the caller can
read or assign `parent[key]`.

> **Term: JSONL / JSON Lines.** A file where *each line* is its own JSON
> document. `edits.log.jsonl` uses it because appending one line is atomic
> and cheap, and the file stays readable even if a line is malformed —
> ideal for logs, wrong for documents.

## What production adds

- **A schema.** Classroom JSON is "whatever parse accepts." Production
  JSON has a contract — `engine/schema/content.schema.json` — checked
  before the data is used (next chapter).
- **Defensive access.** Notice `(content && content.pages) || []` and
  `typeof block.id === 'string'` in `indexHosts`. Production code reading
  a document never assumes the shape it hopes for, *even after schema
  validation*, because this function is also called on candidate content
  mid-edit.
- **Stable round-tripping.** Every writer uses
  `JSON.stringify(content, null, 2) + '\n'` (see `engine/apply-patch.js`
  and `engine/lib/owner.js`) — pretty-printed, trailing newline, so git
  diffs of content changes are minimal and human-reviewable. The data file
  is a first-class artifact in version control, formatted for humans.
- **Choosing what JSON can't express.** Comments, for one — JSON has none,
  so all explanation lives in the docs (`BLOCK_CATALOG.md`) instead of the
  data. That's a real trade-off the format forces.

## Why here, why this way

The whole product promise — "a developer sets a site up once, the owner
maintains it forever" — depends on the site being *data*, because data can
be validated, diffed, patched through an allowlist, and reverted with git.
HTML can't, not safely. The moment the site is one JSON document, every
hard feature becomes a document operation: editing is `applyPatch`,
previewing is "build a copy of the document," publishing is "commit the
document," undo is "revert the commit."

When you design your own data model, steal the id rule: **anything a user
or a program will refer to later needs a stable identifier that survives
reordering and renaming.**

---

## Try it

*(Uses the `learning-lab` scratch client - see atlas 01 for setup.)*

**Exercise 1 (predict, then verify).** Ids are the addressing scheme, and
`build.js` enforces their uniqueness. *Question:* what exactly happens if
two blocks on *different pages* share an id - schema error, build error,
or silent acceptance? **Predict first.** Then edit
`clients/learning-lab/content.json`, change the contact page's
`"contact-header"` block id to `"home-hero"`, and run
`node engine/build.js learning-lab`.

<details><summary>What you should see</summary>

```
Content has duplicate block ids:
  ✗ block id "home-hero" on page "contact" duplicates the one on page "index"
```

The schema *passed* - JSON Schema can't express cross-document
uniqueness - and the hand-written `checkBlockIdUniqueness` caught it
after. Nothing was written to `dist/`. (Restore the id and
rebuild.)</details>

**Exercise 2 (modification, safe).** Developer-tier structural edit: add
a third item to the contact page's `contact-info` block -
`{ "id": "info-hours", "icon": "clock", "label": "Hours", "value": "Mon-Fri 9-5", "href": "tel:0000000000" }`
- then rebuild and open `dist/learning-lab/contact.html`. Then run
`node engine/sitemap.js learning-lab` and find your new item in the edit
map: because it carries an `id`, it is now maintenance-addressable.

## Self-check

1. In a patch, what does `"block": "site"` mean?
   <details><summary>Answer</summary>The target host is the top-level
   `site` object rather than a page block - `indexHosts` seeds the map
   with `'site'` pointing at `content.site`.</details>
2. Why are text-list lines edited by `match` (their exact current text)
   instead of by index?
   <details><summary>Answer</summary>Indexes go stale the moment the
   list changes; an exact-text match either hits the intended line or
   fails loudly (`no list item equal to match ...`) - it can never
   quietly edit the wrong line.</details>
3. Why does `JSON.stringify(content, null, 2) + '\n'` matter, versus
   plain `JSON.stringify(content)`?
   <details><summary>Answer</summary>Pretty-printing plus a trailing
   newline keeps the file diff-friendly: a one-field change shows as a
   one-line git diff, which humans can review and `git revert` can
   cleanly undo.</details>
4. Transfer: you're designing a todo app where users will rename and
   reorder lists. What does this chapter say each list needs?
   <details><summary>Answer</summary>A stable `id` that survives renames
   and reorders - anything users or code will refer to later must not be
   addressed by position or display name.</details>
