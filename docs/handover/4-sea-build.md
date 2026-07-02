# Step 4 — Single-`.exe` editor runtime, no Node install

**Status: built.** `npm run build:exe` produces `build/sea/blockson-editor.exe`
(~90 MB), a self-contained Node runtime that runs the editor on a machine with
**no Node installed**. The owner experience is unchanged (double-click → app
window); only the install gets simpler: runbook §1's "install Node.js" becomes
"copy one file."

## How to use it

```
npm run build:exe                      # → build/sea/blockson-editor.exe
```

Then, on the owner's machine, copy `blockson-editor.exe` to the **repo root**
(next to `engine/` — the same place the launcher scripts go). That's the whole
install: the [owner launcher](../../extras/owner-launcher/README.md) checks for
it there and uses it automatically, falling back to an installed `node` when
it's absent — so the same launcher works on every machine during transition.

The exe replaces the `node` **command**, nothing else. It runs any engine
entry point exactly the way `node` would:

```
blockson-editor.exe engine\serve.js <client>     the owner editor
blockson-editor.exe engine\build.js <client>     build a site into dist\
blockson-editor.exe engine\apply-patch.js <client> "<patch-json>"
```

**git is still a prerequisite for Publish/Restore.** The editor's publish path
shells out to `git` (OPERATOR.md §5/§7); the exe deliberately does not bundle
it. Install git per runbook §1 as before (or use `publish: "none"` / a custom
publish command where git isn't wanted).

## How it works (and why this shape)

Node's [Single Executable Application](https://nodejs.org/api/single-executable-applications.html)
support embeds **one script** into a copy of the Node binary. The temptation is
to bundle the whole engine into that script — and the reason every bundler
project grows hair is exactly that: virtualizing a filesystem for the bundled
code. This build refuses the temptation. The repo **ships as plain files,
exactly as it is today**, and the embedded script
([`scripts/sea-entry.js`](../../scripts/sea-entry.js), ~60 lines) does only one
job: emulate `node <script> [args...]`.

The pipeline ([`scripts/build-sea.js`](../../scripts/build-sea.js)) is the
official SEA recipe, scripted end to end:

1. `node --experimental-sea-config scripts/sea-config.json` turns the entry
   script into an injectable blob;
2. the running `node.exe` is **copied** to `blockson-editor.exe`;
3. [`postject`](https://github.com/nodejs/postject) (a devDependency) injects
   the blob into the copy at the sentinel Node reserves for exactly this;
4. the fresh exe is probed (`BLOCKSON_SEA_PROBE=1`) to confirm it sees and
   normalizes arguments correctly — a build that would silently eat the first
   argument **fails loudly here** instead of on an owner's machine.

At run time, the entry script normalizes the SEA argv layout back to the
node-style `[execPath, scriptPath, ...args]` the engine expects, then loads the
requested script **from disk** with `module.createRequire`. Because the engine
runs from disk as ordinary modules — not from inside the binary — everything
behaves identically to `node`:

- `__dirname` in every engine file is its real directory, so all path
  resolution (themes, blueprints, `clients/`, UI assets) is unchanged;
- `node_modules` resolves from the repo as usual (AJV keeps validating; and the
  engine's documented no-AJV fallback still applies if it's ever missing);
- `spawnSync(process.execPath, [engine/build.js, …])` — how the editor runs
  every candidate/live build in a **fresh child process**
  (`engine/lib/host-node.js`) — re-enters this same launcher, which runs the
  child build exactly as `node` would have. The engine's "builds are spawned,
  never require()d" isolation is preserved with **zero engine changes**.

The one engine-side touch: `engine/apply-patch.js` used to spawn the literal
command `'node'` for its rebuild; it now spawns `process.execPath` — identical
under a normal Node install, and correct inside the exe.

**The exe contains no engine code.** Engine fixes and new blocks arrive as
ordinary file/`git pull` updates and take effect immediately — you rebuild the
exe only when you want a **newer Node runtime** inside it (it embeds the Node
version that ran `build:exe`).

## Verified / still to verify

Verified in the build session (2026-07-01):

- The exe's `engine/build.js` output is **byte-identical** to a normal Node
  build of the same client.
- The full editor loop — serve → click-to-edit → candidate annotated rebuild
  (the spawned-child path) → preview → discard — works with Node **removed
  from `PATH`**, and live content stays untouched.
- The patch CLI round-trips through the exe the same way.
- The proof suite stays 29/29; the build self-checks argv handling every run.

Still on you before shipping to a real owner:

- [ ] **The clean-machine test.** Run the launcher flow on a Windows machine
      with no Node installed — a stripped `PATH` is a close rehearsal, but only
      a genuinely Node-less machine proves the promise. (Windows 11 Home has no
      Sandbox; use a spare PC or a throwaway VM.)
- [ ] **The double-click smoke with the exe in place:** `Edit My Site.vbs` →
      hidden PowerShell → app window → close → nothing left in Task Manager.

## Code signing (do not skip for a fleet)

Injection invalidates the Node binary's Authenticode signature, so the exe is
effectively unsigned and SmartScreen shows "unknown publisher" when it arrives
via a download.

- **On-site install softens it:** files you copy onto the machine locally don't
  carry the mark-of-the-web that fires most SmartScreen prompts — a real reason
  to keep doing installs yourself rather than emailing the exe. Add the
  "More info → Run anyway" step to the break-glass sheet for the re-download
  case.
- For a growing fleet, get a code-signing cert (Azure Trusted Signing is the
  cheap current option) and sign the exe as a step after `build:exe`.

## Runbook wording (fold into `2-install-runbook.md` §1)

The runbook's install-the-runtime step becomes:

> **1. Install the runtime (your job, once)**
>
> Either: install **Node.js 20 LTS or later** from nodejs.org, **or** copy a
> pre-built `blockson-editor.exe` (`npm run build:exe` on your machine) into
> the repo root next to `engine\` — then no Node install is needed on this
> machine at all. The launcher uses the exe automatically when present.
> **git is required either way** for Publish/Restore.

And the corresponding line in [`README.md`](README.md) ("a later, optional
stage… is specified in `4-sea-build.md` as a build-it-next handoff") should now
read that the single-exe runtime **is built** — `npm run build:exe`, this doc.
(Both files had unrelated edits in flight when this landed, so the wording is
parked here rather than applied.)

## Explicitly out of scope

A full **Electron/Tauri** wrapper (true native window + fleet auto-update). It
remains the heavier path, and its auto-update channel reintroduces a phone-home
dependency that sits uneasily with the walk-away promise (point any updater at
the *client's* repo releases if it's ever built). Revisit only if revisiting
machines to ship an editor fix becomes the real pain — see
[`README.md`](README.md).
