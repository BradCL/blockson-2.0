# Atlas 04 — File I/O and paths

## In class you learned…

That programs read and write files — in Node, `fs.readFileSync`,
`fs.writeFileSync` — and that paths point at them. Maybe you hit your
first `ENOENT` because a relative path depended on which folder you ran
the program from.

## In Blockson it lives at…

- `engine/build.js` — reads content and tokens, wipes and rewrites
  `dist/<client>/`, and recursively copies asset folders (`copyDir`).
- `engine/lib/owner.js` — the heaviest file-system user: copies whole
  client folders (`resetCandidate`), stages uploads, backs up and restores
  `content.json`.
- Every entry-point file anchors itself with the same line:
  `const ROOT = path.resolve(__dirname, '..')` (or `'..', '..'` from
  `lib/`).

## A guided read-through

First, the anchoring idiom, from the top of `engine/build.js`:

```js
const ROOT = path.resolve(__dirname, '..');
...
const clientDir  = path.join(ROOT, 'clients', clientName);
const contentPath = path.join(clientDir, 'content.json');
```

`__dirname` is the directory *of the current file* — not of wherever the
user happened to run `node` from. Resolving `ROOT` once from `__dirname`
and building every other path with `path.join` means the engine works the
same from any working directory and on any OS (`path.join` inserts `\` on
Windows, `/` elsewhere — never concatenate paths with `+ '/'`).

Second, the write strategy. `build.js` renders everything into an array
first:

```js
const outputs = [];   // { destPath, content }
for (const page of content.pages) { ... outputs.push({ destPath: filename, content: html }); }
...
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
for (const out of outputs) {
  fs.writeFileSync(path.join(distDir, out.destPath), out.content, 'utf8');
}
```

Why this order? If rendering page 7 of 9 throws, the loop dies **before**
the `rmSync` — the old `dist/` is still intact. Render-to-memory-first
turns "build" into something close to an all-or-nothing operation: you get
the complete new output or the complete old one, never a mixture.

Third, the backup-and-restore pattern, from `engine/apply-patch.js`:

```js
const originalText = fs.readFileSync(contentPath, 'utf8');
...
fs.writeFileSync(contentPath, newText, 'utf8');
// rebuild; and if the build fails:
fs.writeFileSync(contentPath, originalText, 'utf8');
```

The backup is just the original file *as a string in memory* — no `.bak`
file to clean up, no temp directory. Hold the old bytes, attempt the
change, write the old bytes back on failure.

> **Term: atomic.** An operation that either fully happens or fully
> doesn't, with no observable in-between state. True filesystem atomicity
> is hard; Blockson gets *practical* atomicity by sequencing (render
> first, wipe last) and by rollback (backup string).

## What production adds

- **Sync I/O, on purpose.** Tutorials push `async`/callbacks for file I/O;
  every read and write here is the `*Sync` variant. For a CLI tool doing
  one job in sequence, synchronous code is simpler, and simpler is safer.
  Async I/O earns its complexity in servers handling many users — this
  build has exactly one.
- **Recursive operations are written out.** `copyDir` in `build.js` is a
  ten-line recursive walk with `fs.readdirSync(src, { withFileTypes: true })`.
  Read it once and directory recursion stops being magic. (`owner.js` uses
  the built-in `fs.cpSync(..., { recursive: true, filter })` for the
  candidate copy — note the `filter` excluding `edits.log*`: copying
  *almost* everything is a real-world requirement the simple API call
  doesn't cover until you find its options.)
- **Generated vs. source, enforced by location.** Everything the engine
  writes lands in `dist/` or a `__candidate` folder, all gitignored. A
  build can be deleted at any time and nothing of value is lost. Knowing
  which files are disposable is a property you *design in*, not discover.
- **Names as guard rails.** Annotated builds go to
  `dist/<client>__annotated/` — a different directory, so a preview can't
  be deployed as the live site by accident. The path itself enforces the
  invariant (the comment in `build.js` says exactly this).

## Why here, why this way

A static site generator *is* a file-I/O program — its whole output is
files — so its reliability story has to be told in file operations. The
recurring shape is: **decide what the failure state looks like before
writing anything.** Build: old output intact. Patch: original content
restored. Candidate edit: candidate rolled back, preview rebuilt from the
last good state (`applyEdit` in `owner.js` does both). Every write in the
codebase has a matching answer to "and if the next step fails?" — that's
the habit to take with you.
