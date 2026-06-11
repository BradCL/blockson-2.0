# Atlas 05 — Command-line arguments

## In class you learned…

That programs can take arguments: `process.argv` is an array, index 0 is
`node`, index 1 is the script, and the rest is what the user typed. Maybe
you wrote `const name = process.argv[2];`.

## In Blockson it lives at…

Every entry point parses its own arguments by hand — no library:

- `engine/build.js` — positional client name + a boolean flag
  (`--annotate`).
- `engine/serve.js` — positional client name + flags *with values*
  (`--port N`, `--host ADDR`) via a tiny helper, `flagValue`.
- `engine/apply-patch.js` — two positionals, the second being a whole
  JSON document passed as one quoted argument.
- `engine/new-client.js` — a positional that gets format-validated before
  use.

## A guided read-through

`engine/build.js` separates flags from positionals in two lines:

```js
const args    = process.argv.slice(2);
const annotate = args.includes('--annotate');
const clientName = args.find(a => !a.startsWith('--'));
```

The convention doing the work: *flags start with `--`, anything else is a
positional*. `find` takes the first non-flag, so
`node engine/build.js --annotate my-site` and
`node engine/build.js my-site --annotate` both work — order-independence
for free.

`engine/serve.js` needs flags that carry values:

```js
function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
...
if (flagValue('--port')) overrides.port = Number(flagValue('--port'));
```

Find the flag, take the *next* array element as its value. Note the
`Number(...)` — everything in `argv` is a string; the program converts at
the boundary so the rest of the code can trust types.

And the contract every entry point honors when arguments are missing:

```js
if (!clientName) {
  console.error('Usage: node engine/build.js <client-name> [--annotate]');
  process.exit(1);
}
```

Usage line to **stderr**, then a **non-zero exit code**. Both halves
matter: stderr keeps the message out of any output another program might
be capturing from stdout, and the exit code is how scripts and CI detect
failure (`echo $LASTEXITCODE` / `echo $?`).

> **Term: exit code.** The integer a process hands back to whoever started
> it. `0` means success; anything else means failure. It's the only part
> of your program's behaviour that shell scripts, `npm`, git hooks, and CI
> systems can branch on — which is why `apply-patch.js` is careful to exit
> `0` for a *refused* patch (the system worked) but `1` for an *invalid*
> one (the caller's input was wrong).

## What production adds

- **Validate arguments like any other input.** `engine/new-client.js`
  checks the client name against `/^[a-z0-9][a-z0-9-]*$/` before creating
  directories with it, and `owner.js`'s `createSession` re-checks with its
  own regex even though `serve.js` already passed the name in. An argument
  becomes a directory name here — unvalidated, it could be `../something`.
  Arguments are user input; treat them with the same suspicion (see
  [atlas 13](13-security-mindset.md)).
- **Helpful failure beats silent default.** `new-client.js` with a bad
  theme name doesn't fall back to `default` — it lists the available
  themes on stderr and exits. When the user is wrong, tell them what
  *would* be right.
- **Structured data as an argument.** `apply-patch.js` takes a JSON patch
  as one quoted argv entry and `JSON.parse`s it inside a `try/catch` with
  a specific message ("patch argument is not valid JSON"). Passing JSON
  through a shell is fragile (quoting rules differ between shells) — which
  is one reason the owner editor sends patches over HTTP instead.
- **No argument-parsing library.** Frameworks like `commander` or `yargs`
  exist, but for two flags they would be the project's third dependency.
  Dependency count is a cost you pay forever; these twenty hand-rolled
  lines are the cheaper deal *at this scale*.

## Why here, why this way

The CLIs are the developer tier's entire user interface — there is no
admin web panel — so their ergonomics are product decisions: order-
independent flags, usage lines that double as documentation, exit codes
that let `npm test` and the proof suite chain builds and assert on
failure. The proof suite itself drives these CLIs as subprocesses
(`spawnSync(process.execPath, [path.join(__dirname, 'build.js'), ...])` in
`engine/_run-proofs.js`), so a stable argument contract isn't politeness —
the tests depend on it.
