# Step 2 — On-site install runbook

Do this on the machine the owner will edit from (their office PC). Goal: by the end,
the owner can **double-click one icon and edit their site**, and a real Publish has
gone live in front of you. Everything technical is your job here — the owner watches,
they don't type.

Prerequisites from [Step 1](1-account-setup.md) must be done: repo, host, domain, and
form delivery all in the client's name.

## 1. Install the runtime (your job, once)

- Install **Node.js 18 LTS or later** from nodejs.org (the Windows `.msi` is a
  next-next-finish install). This is the only runtime the engine needs.
- Install **git** if it isn't already present.

> The single-`.exe` build (the later stage in [the kit README](README.md)) removes
> this Node-install step entirely. For your first few installs, the `.msi` is fine.

## 2. Get the repo onto the machine

```
git clone <the client's repo URL>
cd <repo>
npm install
```

`npm install` pulls the engine's two runtime deps (`ajv`, `ajv-formats`). Confirm the
engine is healthy:

```
node engine/_run-proofs.js
node engine/build.js <client-name>
```

A clean build means `content.json` is valid and the editor will start.

## 3. Set up a push credential the owner never sees

This is the one genuinely fiddly piece — and it's *your* job, done once, so the owner
never touches git. The editor's **Publish** runs a non-interactive `git push`
(OPERATOR.md §7); it never prompts, so the credential must be stored on the machine
ahead of time, scoped to **this one repo**:

- **Deploy key (recommended):** generate an SSH key on this machine, add the **public**
  key as a *write-enabled deploy key* on the client's repo, set the repo's `origin` to
  the SSH URL. Scoped to exactly one repo, revocable by the client, nothing of yours
  involved.
- **Or a credential helper:** a fine-grained token with write access to only this repo,
  stored in the OS credential manager (Windows Credential Manager / Git Credential
  Manager).

Verify it works without a prompt:

```
git commit --allow-empty -m "handover: verify push" && git push
```

If that pushes silently, the owner's Publish will too.

## 4. Create the one-click launcher

Use the launcher in [`extras/owner-launcher/`](../../extras/owner-launcher/README.md)
— it gives the owner a clean app window (no console, no browser tabs) and shuts the
server down when they close it. Install it:

1. Copy `editor-launcher.ps1` and `Edit My Site.vbs` to the **repo root** (next to
   `engine/`).
2. Edit `Edit My Site.vbs` and set the client folder name on the marked
   `client = "..."` line.
3. Right-click `Edit My Site.vbs` → *Send to → Desktop (create shortcut)*, rename the
   shortcut to something the owner recognizes, and give it an icon
   (*Properties → Change Icon*).

Double-clicking it starts the editor hidden and opens it in an Edge/Chrome app-mode
window; closing the window stops the server. See the launcher's README for behavior,
fallbacks, and limits.

> This is the no-extra-binary stage and still relies on the Node install from §1. The
> next stage — a single signed `.exe` that removes the Node-install step entirely — is
> specified in [`4-sea-build.md`](4-sea-build.md), to be built once the flow has proven
> out on a few clients.

## 5. Smoke-test a real Publish in front of the owner

Don't leave until you've watched the whole loop work on *this* machine:

1. Double-click the launcher. Editor opens.
2. Make a trivial real edit (a word in a headline), **Keep** it, then **Publish**.
3. Watch the host rebuild and the change appear on the **live domain** (give it the
   host's build minute).
4. Click **Restore** and confirm the change rolls back and republishes.

If Publish/Restore both work here, the owner is genuinely self-sufficient. If push
fails, fix the credential (§3) — the local save always succeeds, only the push step
can fail independently (OPERATOR.md §10).

## 6. Hand over and walk

- Walk the owner through clicking the launcher and making one edit themselves.
- Give them the **break-glass sheet** ([Step 3](3-owner-break-glass-sheet.md)),
  filled in, printed, and saved.
- Have the client remove your collaborator access on the repo and host (or do it
  together). Confirm the site still serves and the launcher still works after you're
  removed — that's the proof the walk-away is real.

## Done when

- [ ] Node + git installed; engine builds clean on the machine.
- [ ] Repo cloned; scoped push credential pushes with no prompt.
- [ ] One-click launcher on the desktop, opens the editor.
- [ ] A live Publish **and** a Restore verified on the real domain.
- [ ] Break-glass sheet handed over; your access removed; site still works.
