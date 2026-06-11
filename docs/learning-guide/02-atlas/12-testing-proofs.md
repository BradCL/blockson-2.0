# Atlas 12 — The proof suite as a testing philosophy

## In class you learned…

Unit testing: small functions, asserted in isolation, ideally with mocks
for anything slow or external. `expect(add(2, 2)).toBe(4)`. Coverage
percentages as the measure of done.

## In Blockson it lives at…

`engine/_run-proofs.js` — one file, nineteen "proofs," run by `npm test`.
No test framework: plain Node, a `results` list, and `process.exit(1)` if
anything failed. The file's 80-line header comment is a table of contents
worth reading in full — each proof is described as a *property of the
system*, not a function under test.

## A guided read-through

The vocabulary shift is the content here. Compare:

- *Test:* "`applyPatch` returns `ok:false` for action `replace`."
- *Proof 3:* "a forbidden structural write is **blocked at the
  resolver**" — asserted by running a real patch against a real client
  and checking that *nothing on disk changed*.

The suite's helpers tell you its level of abstraction:

```js
function build(client, extra = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build.js'), client, ...extra],
    { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}
```

It runs the **actual CLI as a subprocess** — the same entry point a
developer types — and asserts on exit codes and emitted files. Proof 13
starts the real HTTP server on an ephemeral port and probes it with real
requests (foreign `Host` header, header-less POST, encoded path
traversal). Proof 18 creates a throwaway git repository *with a local
bare origin* and verifies that publishing makes exactly one pushed
commit. Nothing is mocked anywhere in the suite.

A second pattern: **proving absence.** `presentAnnotations` scans built
HTML for every `data-bk-*` attribute so proof 1 can assert that live
builds contain *none* — and, in the same proof, that annotated builds
contain one for *every* field the edit map reports, and none it doesn't.
Both directions of a "never/always" invariant, checked mechanically.

A third: **known-bad fixtures.** Proofs 11, 12, and 19 feed deliberately
broken inputs (a malformed blueprint, a bad theme, a blueprint smuggling
a `javascript:` link) and assert they fail *with named reasons*. The
error path is specified behaviour, so it's tested like one.

> **Term: end-to-end (e2e) test.** A test that exercises the system
> through its real interfaces — CLI, HTTP, filesystem, git — rather than
> calling internal functions directly. Slower per test, but each one
> certifies something a user-visible promise depends on.

## What production adds

- **Tests as the contract.** The developer tutorial says it directly:
  "the proofs are not unit tests — they are the *contract*." Every safety
  claim in the README ("live HTML never carries annotations," "one
  publish = one commit") has a numbered proof. If you can't point at the
  test for a guarantee, you don't have the guarantee — you have a hope.
- **State restoration inside tests.** Proofs that patch the example
  clients put the original content back afterwards (the suite must pass
  *on a clean tree*, and leave one). Test hygiene is part of the test.
- **The suite as a regression ratchet.** Each new feature in the repo's
  history (visibility flag → proof 17, ledger → proof 16, item
  blueprints → proof 19) landed *with* its proof. The suite only grows,
  and the old guarantees re-verify on every run.
- **Adversarial cases as first-class citizens.** A classroom suite tests
  the happy path. Half of this suite is things that must *fail*: bypass
  attempts (the plain-`set` route into `themeOverrides`, proof 6),
  hostile uploads (non-image bytes under an image name, proof 8),
  traversal probes (proof 13). The test list doubles as a threat model.

## Why here, why this way

Why e2e instead of unit tests? Because of *what's being promised*. A
unit test on `applyPatch` can't notice that `serve.js` forgot to call it,
or that a renderer leaks an annotation into live HTML. The system's
promises are end-to-end ("a bad patch can never leave a site broken"), so
only end-to-end checks can certify them — and the engine's speed makes
this affordable: nineteen full-system proofs, including real builds, real
HTTP, and real git, in well under a minute.

The transferable rule: **write your tests at the level of the sentence
you'd say to the person relying on you.** If the sentence is "you cannot
break the site from the editor," a mock-free test must be able to try.
