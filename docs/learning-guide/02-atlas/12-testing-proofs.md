# Atlas 12 — The proof suite as a testing philosophy

## In class you learned…

Unit testing: small functions, asserted in isolation, ideally with mocks
for anything slow or external. `expect(add(2, 2)).toBe(4)`. Coverage
percentages as the measure of done.

## In Blockson it lives at…

`engine/_run-proofs.js` — one file, 23 "proofs," run by `npm test`.
No test framework: plain Node, a `passed` counter with per-proof
`failures` arrays, and a final
`process.exit(passed === TOTAL ? 0 : 1)`. The file's 90-line header
comment is a table of contents
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
  blueprints → proof 19) landed *with* its proof — and so does each fix
  driven by real use: the first live site exposed a page-header whose
  background silently fell back to a hard-coded `banner.jpg`, and the
  engine fix landed with proof 20. The suite only grows, and the old
  guarantees re-verify on every run.
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
this affordable: 23 full-system proofs, including real builds, real
HTTP, and real git, in well under a minute.

The transferable rule: **write your tests at the level of the sentence
you'd say to the person relying on you.** If the sentence is "you cannot
break the site from the editor," a mock-free test must be able to try.

---

## Try it

**Exercise 1 (predict, then verify).** *Question:* do the proofs depend
on your scratch client? If `clients/learning-lab/` contains experiments
(even broken ones), does `npm test` still pass? **Predict, then run**
`npm test` with your learning-lab in whatever state the previous
chapters left it.

<details><summary>What you should see</summary>

`23/23 proofs passed.` The suite exercises the example clients, the
shipped blueprints/themes, and throwaway sandboxes it creates itself -
your scratch client isn't part of the contract, so it can't break the
contract. (This is also why the guide had you experiment there.)</details>

**Exercise 2 (predict, then verify).** Pick proof 1's claim - "live HTML
carries no `data-bk-*`" - and *replicate it by hand* against your own
client: build learning-lab both ways and search both outputs for
`data-bk-`. Predict the two counts before you look.

<details><summary>What you should see</summary>

Zero matches in `dist/learning-lab/`, several in
`dist/learning-lab__annotated/`. You just ran a one-client version of
`presentAnnotations` - the suite does the same scan across three clients
and also asserts the *reverse* direction (every edit-map field has an
annotation).</details>

## Self-check

1. Why does the suite run `build.js` as a subprocess instead of
   requiring it as a module?
   <details><summary>Answer</summary>The promise under test includes
   the CLI contract itself - exit codes, stderr, argument handling -
   and the only way to test what a user types is to run what a user
   types.</details>
2. What's a "known-bad fixture" and which proofs use one?
   <details><summary>Answer</summary>A deliberately invalid input whose
   *rejection with named reasons* is the expected behaviour - proofs 11
   (bad blueprint), 12 (bad theme), and 19 (bad item blueprint) all
   assert failure modes, not just successes.</details>
3. Why must the suite pass "on a clean tree"?
   <details><summary>Answer</summary>Proofs that mutate example clients
   restore them afterwards; requiring a clean tree before *and* after
   makes test pollution itself a detectable failure.</details>
4. Transfer: you added a guard that strips EXIF from uploads
   server-side. Write the one-sentence proof you'd add.
   <details><summary>Answer</summary>Something like: "an uploaded JPEG
   containing GPS EXIF lands in the candidate's img/ with no EXIF
   segment, and the edit still succeeds" - phrased as the user-facing
   promise, exercised through `owner.applyEdit` with real
   bytes.</details>
