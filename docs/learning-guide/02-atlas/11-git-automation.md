# Atlas 11 — Automating git with child processes

## In class you learned…

Git as a thing *you* type: `git add`, `git commit`, `git push`, maybe
`git revert`. And separately, perhaps, that programs can run other
programs.

## In Blockson it lives at…

`engine/lib/owner.js` — the owner's Publish button *is* a git automation.
The pieces:

- `git(args)` — a three-line wrapper over Node's
  `spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })`.
- `runPublish` — add → commit → push, with a plain-language failure
  message at each step.
- `restore` — finds the last publish commit and `git revert`s it.
- `PUBLISH_MARKER` — the trick that makes restore possible.

(`buildClient` in the same file and the `spawnSync` call in
`engine/apply-patch.js` use the same API to run *the engine itself* as a
subprocess — one mechanism, two uses.)

## A guided read-through

The publish path, trimmed to its spine:

```js
const add = git(['add', '--', ...toAdd]);
if (add.status !== 0) {
  return { ok: false, message: `Could not stage the change for publishing:\n${(add.stderr || '').trim()}` };
}
const commit = git(['commit', '-m', message]);
if (commit.status !== 0) { ... }
const push = git(['push']);
if (push.status !== 0) {
  return { ok: false, message: `The change was saved and recorded, but sending it to the host failed (it will go out with the next successful publish):\n...` };
}
return { ok: true, message: 'Published — the change is on its way to the live site.' };
```

Read the failure messages as a sequence: each one tells the owner *how far
things got* and what that means ("it will go out with the next successful
publish" — because the commit exists locally even though the push failed).
Automating a multi-step tool means narrating partial success.

Three details that separate this from naive shelling-out:

1. **Arguments as an array, never a string.** `git(['commit', '-m',
   message])` passes `message` as one argument no matter what characters
   it contains. There is no shell parsing it, so there is nothing to
   inject. Contrast the *custom* publish-command path in `runPublish`,
   which **does** go through a shell (`spawnSync(cmd, { shell: true })`) —
   and therefore first reduces the interpolated message to a conservative
   character set (`shellSafeMessage`). The comment explains the asymmetry:
   "there the message travels as a spawn argument."
2. **Probing before using.** `git(['--version'])` first; if it fails with
   `ENOENT` (the OS error for "no such program"), the message is "git is
   not installed (or not on PATH)" — not a crash, and not a mystery.
3. **`status !== 0` after every call.** `spawnSync` doesn't throw when
   the command fails; *you* check the exit code. Forgetting this is the
   classic child-process bug — everything looks fine while nothing
   happened.

**Restore** is the payoff. Every publish commit message embeds
`[blockson-publish <client>]` (the `{marker}` in `publishMessage`). To
undo, `restore` greps history for it:

```js
let log = git(['log', '-n', '1', '--fixed-strings', '--grep', PUBLISH_MARKER(session.client), '--format=%H']);
...
const revert = git(['revert', '--no-edit', hash]);
if (revert.status !== 0) {
  git(['revert', '--abort']);
  ...
```

`--fixed-strings` because the marker contains `[` and `]`, which `--grep`
would otherwise read as regex. `revert --abort` on failure so a conflicted
revert never leaves the repo wedged. And because one publish = one commit
(the whole staged session), one revert = the whole session undone — the
*session model and the commit model were designed to coincide* (proof 18
verifies this over a real throwaway repository).

> **Term: child process.** A program your program starts and supervises.
> `spawnSync` runs it to completion and hands back
> `{ status, stdout, stderr, error }` — the same four things you'd see in
> a terminal, as data.

## What production adds

- **Git as an application database.** Version control here isn't a dev
  tool — it's the *owner's undo button* and the publish transport, driven
  entirely by code. Commits-as-transactions is a real architectural
  pattern: atomic, logged, revertable, and free.
- **Scoped staging.** `git add -- <specific paths>` (only the client's
  `content.json` and `img/`), never `git add -A`. An automation must not
  commit whatever else happens to be lying in the working tree.
- **Failure is a message, not an exception.** Every branch returns
  `{ ok, message }` in language an owner can act on. The process boundary
  is where developer-facing errors (`status`, `stderr`) get translated
  into user-facing ones.
- **Testing against the real thing.** Proof 18 builds a sandbox repo with
  a local bare origin and runs actual publishes against it — because the
  thing being claimed ("exactly one pushed commit per session") is a git
  behaviour, and only git can confirm it.

## Why here, why this way

The product promise is "no CMS, no database, no hosting bill." Something
still has to move bytes to the host and remember history — git was
already there, the static hosts deploy from it, and the developer already
trusts it. The design lesson: before adding infrastructure, check whether
a tool already in the stack can be *driven by code* to do the job. Often
the boring answer is the robust one.
