# Atlas 03 — Input validation and JSON Schema

## In class you learned…

To check user input before using it — `if (!email.includes('@')) …` — and
maybe that HTML forms have `required` and `pattern` attributes. Validation
was a handful of `if` statements at the top of a function.

## In Blockson it lives at…

- `engine/schema/content.schema.json` — the contract, written in **JSON
  Schema** (draft 2020-12): a standard language for describing the shape
  of JSON, itself written in JSON.
- `engine/lib/validate.js` — the gatekeeper: `validate(content)` runs the
  schema through **ajv** (a JSON Schema validator library), formats the
  errors (`formatErrors`), and falls back to a hand-rolled structural
  check (`fallbackValidate`) if ajv isn't installed.
- `engine/build.js` — the enforcement point: validation runs before a
  single byte is written; failure is `process.exit(1)`.
- Validation of *other* inputs lives next to those inputs:
  `validateInputs`/`validateValue` in `engine/lib/scaffold.js` for
  blueprint form values, `validateTokenValue` in `engine/lib/patch.js`
  for theme tokens, `prepareUpload` in `engine/lib/owner.js` for files.

## A guided read-through

The core of `validate()` in `engine/lib/validate.js`:

```js
const ajv = new Ajv({ allErrors: true, strict: false });
if (addFormats) addFormats(ajv);

const valid = ajv.validate(schema, content);
if (!valid) {
  return { ok: false, errors: formatErrors(ajv.errors) };
}
return { ok: true, errors: [] };
```

`allErrors: true` matters: by default ajv stops at the first problem, but
a developer fixing a content file wants the whole list at once. Then
`formatErrors` translates ajv's machine-shaped output into sentences:

```js
if (err.keyword === 'required') {
  const missing = err.params && err.params.missingProperty;
  return `${field ? field + '.' : ''}${missing} is required`;
}
```

So instead of `instancePath: "/pages/0/meta", keyword: "required"`, the
developer reads `pages.0.meta.title is required`. **Error translation is
part of validation** — an error nobody can act on is barely better than no
error.

Now the schema itself. Two recurring moves in
`engine/schema/content.schema.json`:

1. `"additionalProperties": false` on nearly every object — unknown keys
   are *rejected*, not ignored. A typo like `"headlne"` fails loudly
   instead of silently rendering an empty headline.
2. Reusable definitions: `"$ref": "#/$defs/safeHref"` wherever a link
   target appears, so the rule "an href must be https, http, mailto, tel,
   sms, an anchor, or a relative path" is written once and referenced
   everywhere.

> **Term: ajv.** "Another JSON Validator" — the standard JavaScript
> library that takes a JSON Schema and a document and answers valid/not,
> with a list of violations. It's one of only two runtime dependencies in
> this entire project (`package.json`: `ajv`, `ajv-formats`).

## What production adds

- **Validation as a *gate*, not a courtesy.** The classroom version warns
  and continues. `engine/build.js` refuses to proceed: invalid content
  produces *no output at all*, so a broken site can never be deployed by
  accident. Where the gate sits matters as much as what it checks.
- **Graceful degradation, loudly.** If ajv isn't installed,
  `fallbackValidate` still checks structure (required keys, registered
  block types, link schemes) and attaches a warning: *"AJV not installed —
  field-level validation is disabled."* Reduced checking is acceptable;
  *silent* reduced checking is not.
- **Checks the schema language can't express.** Block id uniqueness spans
  the whole document, which JSON Schema can't state — so
  `checkBlockIdUniqueness` in `engine/build.js` does it in code, after the
  schema passes. Real systems layer hand-written checks on top of
  declarative ones.
- **The same rule in two places, deliberately and with a comment.**
  `SAFE_HREF_RE` in `validate.js` mirrors `$defs/safeHref` in the schema
  so the link-scheme guard holds even without ajv — and the comment above
  it says exactly that. When duplication is unavoidable, document the
  pairing so future editors change both.

## Why here, why this way

The schema is the **contract between the two tiers**. The engine is
"frozen" (the header comment in `build.js` calls it the *structural
immutability contract*): structure lives in code, content lives in data,
and they only meet through the schema. That's why the error messages name
exact field paths — the schema is the API documentation a content author
programs against.

It's also why validation is *re-run constantly* rather than trusted once:
every owner edit triggers a candidate rebuild, and the rebuild starts with
`validate()`. The build is the final acceptance gate for every change in
the system — patches, blueprints, uploads — because it's the one check
that can't be bypassed without also not producing a site.

---

## Try it

*(Uses the `learning-lab` scratch client - see atlas 01 for setup.)*

**Exercise 1 (predict, then verify).** *Question:* if you delete a
required field AND add a misspelled one in the same file, does the build
report one error or both? **Predict.** Then in
`clients/learning-lab/content.json` delete the home page's
`meta.description` and rename the hero's `"headline"` key to
`"headlne"`, and build.

<details><summary>What you should see</summary>

```
Validation failed:
  ✗ pages.0.meta.description is required
  ✗ pages.0.blocks.0.fields has unknown property "headlne"
```

Both at once - that is `allErrors: true` in `validate()`. And the typo
was *caught* rather than ignored - that is `additionalProperties: false`
in the schema. (Restore both and rebuild.)</details>

**Exercise 2 (modification, safe).** Optional fields are additive: add
`"facebook": "https://facebook.com/learninglab"` to `site.contact` in
learning-lab and rebuild - it passes, because the schema lists
`facebook` as an allowed (but not required) property of `contact`. Now
try `"tiktok"` instead. Predict, then build.

<details><summary>What you should see</summary>

`site.contact has unknown property "tiktok"` - allowed keys are
enumerated; everything else is refused.</details>

## Self-check

1. Which file is the *only* place the content contract is defined, and
   which function loads it?
   <details><summary>Answer</summary>`engine/schema/content.schema.json`,
   loaded (and cached) by `loadSchema()` in
   `engine/lib/validate.js`.</details>
2. What happens to the build if `ajv` was never installed?
   <details><summary>Answer</summary>`validate()` falls back to
   `fallbackValidate` - structural checks plus the link-scheme scan -
   and attaches a loud warning telling you to run `npm install`. The
   build still runs; the degradation is announced, never
   silent.</details>
3. Why does block-id uniqueness live in `build.js` instead of the
   schema?
   <details><summary>Answer</summary>JSON Schema cannot express "this
   string must be unique across every block on every page" -
   cross-document rules need code
   (`checkBlockIdUniqueness`).</details>
4. Transfer: your API accepts a JSON `profile` object. A user sends
   `{"name":"...","nmae":"..."}`. What design choice from this chapter
   decides whether they ever find out?
   <details><summary>Answer</summary>`additionalProperties: false` -
   rejecting unknown keys turns the silent typo into a named
   error.</details>
