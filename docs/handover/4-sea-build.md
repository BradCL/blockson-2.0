# Step 4 (next) — Single-`.exe` build, no Node install

**Status: not built yet — this is a handoff spec for a future session.** Stages 1–3 of
the handover kit work today on top of an installed Node + the
[owner launcher](../../extras/owner-launcher/README.md). This stage removes the
"install Node.js" step from the install runbook entirely, so the editor runs on a
machine with no Node at all.

## Goal

A distributable where the owner's machine needs **no Node install** — the editor's
runtime is bundled. The owner experience is unchanged (double-click → app window); only
the install gets simpler and more uniform across strangers' PCs.

## The shape that keeps this easy

Do **not** try to pack the whole repo into the binary. The hard part of every bundler
is virtualizing a filesystem for bundled assets, and you don't need it. Instead:

> Ship the repo folder **as files, exactly as it is today** (engine, themes, blueprints,
> `clients/<name>/`, the launcher), and make the `.exe` simply be **"Node without an
> install"** — a self-contained interpreter that runs `engine/serve.js`.

Nothing about how the engine reads/writes `clients/`, themes, or UI assets changes,
because none of it moves into the binary. The `.exe` only replaces the `node` command.

The owner launcher then changes one line: instead of spawning `node`, it spawns the
bundled exe (e.g. `blockson-editor.exe engine\serve.js <client> ...`). The VBS/PS1
flow, app-mode window, and shutdown logic stay identical.

## Recommended tool: Node SEA

Node's built-in [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
(Node 20+). Official, no third-party runtime, no native-addon concerns (the engine has
**zero runtime native addons** — `sharp`/`playwright` are dev-only; runtime deps are
just `ajv` + `ajv-formats`).

Rough build sequence (verify against the current Node docs — the API is still evolving):

1. **Bundle the entry to one file.** SEA injects a single script, so first bundle
   `engine/serve.js` and everything it `require`s into one CJS file with esbuild or
   `@vercel/ncc`:
   `esbuild engine/serve.js --bundle --platform=node --outfile=build/serve.bundle.js`
   - Watch for anything `serve.js` loads by *path at runtime* (UI assets, themes,
     blueprints, the client folder). Those should stay on disk and be resolved relative
     to the repo root / cwd — confirm none are pulled in via `require` expecting to be
     bundled. The "files stay on disk" shape above is what makes this safe.
2. **SEA config** (`sea-config.json`): point `main` at the bundle, set
   `disableExperimentalSEAWarning: true`, generate the blob with
   `node --experimental-sea-config sea-config.json`.
3. **Make the exe:** copy `node.exe`, inject the blob with `postject`
   (`npx postject blockson-editor.exe NODE_SEA_BLOB sea-blob.blob --sentinel-fuse ...`).
4. Result: `blockson-editor.exe` (~80–110 MB; it embeds the Node runtime).

Alternative if SEA's single-file bundling is fighting you: **`@yao-pkg/pkg`** (the
maintained fork of Vercel's `pkg`) traces the dep tree for you. Acceptable, but it's
third-party; prefer SEA.

## Must-verify before shipping

- [ ] **Runs on a Node-less machine.** Test on a clean Windows VM with **no Node
      installed** — this is the entire point and the only test that proves it.
- [ ] **Publish/Restore still work.** The editor shells out to `git`
      (OPERATOR.md §7) — the exe does **not** remove the git dependency. Either keep git
      as an install prereq (document it) or ship a portable git alongside. Decide and
      write it into the runbook.
- [ ] **Candidate build writes correctly.** Confirm an edit → candidate rebuild → live
      Publish round-trips, since the bundled engine still reads/writes real files on
      disk.
- [ ] **The proof suite passes against the bundle.** Run `engine/_run-proofs.js` logic
      against the bundled entry path, or at minimum smoke the build + serve paths, so
      bundling didn't drop a dynamically-required module.
- [ ] **The launcher uses the exe.** Update `editor-launcher.ps1` to spawn the exe
      instead of `node`, and re-test the hidden-start + shutdown flow.

## Code signing (do not skip for a fleet)

An unsigned `.exe` handed to strangers triggers SmartScreen's "unknown publisher"
warning, which directly undercuts the "trust me, you're safe" pitch.

- **On-site install softens it:** files copied locally don't carry the
  mark-of-the-web that fires most SmartScreen prompts — a real reason to keep doing
  installs yourself rather than emailing the exe.
- For a growing fleet, get a code-signing cert (Azure Trusted Signing is the cheap
  current option) and sign the exe as part of the build.

## Deliverable for that session

- A `build:exe` npm script (or a documented one-off) producing `blockson-editor.exe`.
- The build artifacts (sea-config, bundle step) checked in or scripted — not a manual
  recipe in someone's head.
- `editor-launcher.ps1` updated to use the exe, with a config switch or auto-detect so
  it still works with a plain `node` install during transition.
- Install runbook §1 updated: "install Node" becomes "(optional) install Node — or use
  the bundled exe," with the git prerequisite called out explicitly.

## Explicitly out of scope here

A full **Electron/Tauri** wrapper (true native window + fleet auto-update). It's the
heavier path, and its auto-update channel reintroduces a phone-home dependency that
sits uneasily with the walk-away promise (point any updater at the *client's* repo
releases if it's ever built). Revisit only if revisiting machines to ship an editor fix
becomes the real pain — see [`README.md`](README.md).
