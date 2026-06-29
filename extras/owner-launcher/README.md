# Owner editor launcher (Windows)

A one-click way for a business owner to open their site editor — a clean app window,
no console, no terminal, and nothing left running after they close it. This replaces
the bare `.bat` from the handover runbook
([`docs/handover/2-install-runbook.md`](../../docs/handover/2-install-runbook.md) §4).

Two files, both copied to the **repo root** (next to `engine/`) at install time:

| File | Role |
|---|---|
| `editor-launcher.ps1` | The logic: starts `engine/serve.js <client>` hidden, waits for it, opens the editor in Edge/Chrome **app mode** (a standalone window, no tabs or address bar) with a dedicated browser profile, and stops the server when that window closes. |
| `Edit My Site.vbs` | The owner's entry point: runs the `.ps1` fully hidden so nothing flashes on screen. The owner double-clicks a desktop shortcut to this. |

## How it behaves

- **No console window** — the `.vbs` runs PowerShell with a hidden window.
- **App-window feel** — Edge/Chrome `--app=` mode gives a titled window with the
  site's own taskbar entry; the owner can't tell it's a browser.
- **Clean shutdown** — the launcher waits on the app window (a dedicated
  `--user-data-dir` makes it a fresh, owned instance), then stops the Node server, so
  no orphaned `node` process is left behind. If the owner relaunches while the server
  is already up, it just opens another window and leaves the running server alone.
- **Friendly failures** — missing Node, or a server that won't start, shows a plain
  dialog (with the startup error to hand to a developer), never a stack trace. Startup
  output is logged to `.editor-out.log` / `.editor-err.log` at the repo root.
- **Graceful fallback** — if neither Edge nor Chrome is found, it opens the default
  browser and uses a blocking "click OK when finished" dialog as the stop control.

## Install steps

1. Copy both files to the repo root.
2. Open `Edit My Site.vbs` in a text editor and set the client folder name on the
   marked line (`client = "..."`). Port is read from the client's
   `owner-config.json` (default `4173`); pass `-Port` to the `.ps1` only if you need to
   override it.
3. Right-click `Edit My Site.vbs` → *Send to → Desktop (create shortcut)*. Rename the
   shortcut to something the owner recognizes and give it an icon
   (shortcut *Properties → Change Icon*).
4. Double-click it and confirm the editor window opens; close it and confirm `node` is
   gone from Task Manager.

## Notes / limits

- **Windows only.** It uses VBScript + PowerShell + the Windows process model. A
  macOS/Linux owner needs a small shell-script equivalent (same shape: start hidden,
  open `--app`, wait, kill).
- **git still required for Publish/Restore.** This launcher only starts the editor; the
  editor's publish path shells out to `git` (OPERATOR.md §7), so git must be installed
  and the push credential set up per the runbook.
- This is the lightweight, no-extra-binary stage. The next stage — folding the Node
  runtime into a single signed `.exe` so the machine needs no Node install at all — is
  specified in [`docs/handover/4-sea-build.md`](../../docs/handover/4-sea-build.md).
