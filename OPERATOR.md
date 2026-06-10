# OPERATOR.md — Developer Deploy Guide

This is the guide for the **setup tier**: the developer who sets a client site up,
connects it to a host, and hands the day-to-day editor over to the business owner.
If you're authoring a theme or a blueprint, see [THEME_AUTHORING.md](THEME_AUTHORING.md)
/ [BLUEPRINT_AUTHORING.md](BLUEPRINT_AUTHORING.md) instead. For the engine's design and
guarantees, see [SPEC.md](SPEC.md).

---

## 1. Prerequisites

- **Node.js 18 or later** (the engine and editor are stdlib-only beyond the schema
  validator — no build tooling, no framework).
- **git**, if you want the default publish/rollback flow (§5). Not required for
  `publish: "none"` or a custom publish command.
- A **static host** that can build from a git repo (Netlify, Cloudflare Pages, GitHub
  Pages via Actions, etc.) or accept a folder upload (any S3-style bucket).

---

## 2. Get the code, install, build

```
git clone <your fork/repo>
cd blockson
npm install            # installs ajv + ajv-formats — required for full validation
node engine/_run-proofs.js   # optional: confirms the engine is healthy (npm test)
```

---

## 3. Set up a new client

```
node engine/new-client.js <client-name> [theme]
```

This creates `clients/<client-name>/` with a minimal, schema-valid starter
`content.json` on the chosen theme (default: `default`) and an empty `img/` folder.
Then:

1. Add the images it references (`logo-white.png`, `logo-black.png`, `favicon.png`,
   `banner.jpg`) to `clients/<client-name>/img/`.
2. Edit `content.json` — see [BLOCK_CATALOG.md](BLOCK_CATALOG.md) for every block
   type's fields, [README.md](README.md) for theme presets, and
   [BLUEPRINT_AUTHORING.md](BLUEPRINT_AUTHORING.md) if you want to add a whole page
   from a blueprint instead of writing blocks by hand.
3. Build it:

```
node engine/build.js <client-name>
```

The build validates `content.json` against the schema first and writes nothing if it
fails — the error names the exact field path. Output lands in
`dist/<client-name>/` (gitignored — see §4).

---

## 4. Connecting a client to a host

`dist/` is gitignored: the repo holds **source** (`content.json`, theme tokens, the
engine), not built HTML. The host runs the build. Two common shapes:

### Git-connected static host (Netlify, Cloudflare Pages, etc.)

Point the host at this repo and configure:

| Setting | Value |
|---|---|
| Build command | `npm install && node engine/build.js <client-name>` |
| Publish directory | `dist/<client-name>` |

Every push to the connected branch rebuilds and redeploys that client's site. This is
also what makes the **default publish mode** (§5) work end-to-end: the owner editor
commits and pushes `clients/<client-name>/content.json` (+ `img/`), the host notices
the push, rebuilds, and the live site updates — with no manual deploy step.

If one repo serves multiple clients, give each its own host project pointed at the
same repo with a different `<client-name>` in the build command.

### Plain static host (S3, GitHub Pages without Actions, etc.)

Run the build yourself and upload the result:

```
node engine/build.js <client-name>
# upload the contents of dist/<client-name>/ to the host
```

In this shape, `publish: "none"` (§5) is usually the right per-client setting —
the owner editor still saves and rebuilds locally, but does not attempt to push;
you redeploy on your own schedule.

---

## 5. Per-client config: `owner-config.json`

Optional file at `clients/<client-name>/owner-config.json`, read by
`engine/lib/owner.js`. All keys are optional; anything omitted falls back to the
default shown.

| Key | Default | Meaning |
|---|---|---|
| `clientName` | the client folder name | Display name shown in the editor UI |
| `publish` | `"git"` | `"git"` (add/commit/push), `"none"` (local only), or a custom shell command (see below) |
| `publishMessage` | `"Site update ({client}): {summary} {marker}"` | Commit/command message template — `{client}`, `{summary}`, `{marker}` are substituted |
| `contact` | `null` | `{ "name": ..., "email": ... }` shown to the owner as "who to call for anything beyond this editor" |
| `host` | `"127.0.0.1"` | Bind address for `engine/serve.js` |
| `port` | `4173` | Port for `engine/serve.js` |
| `allowRemote` | `false` | If `true`, accepts non-loopback requests — only set this on a trusted network; see §7 |

Example (`clients/example-contractor/owner-config.json`):

```json
{
  "clientName": "True North Contracting",
  "publish": "none",
  "contact": { "name": "Your developer", "email": "dev@example.com" }
}
```

**Custom publish command.** Set `publish` to a shell command string containing
`{message}` and/or `{client}`; it runs from the repo root via the system shell after
every Approve and Restore. Use this to call a deploy hook directly (e.g. a host's
build-hook URL via `curl`) instead of relying on git push. A failing or missing
command is reported to the owner in plain language — the local site is always saved
and rebuilt regardless of whether publishing succeeds.

---

## 6. Running the owner editor

```
node engine/serve.js <client-name> [--port N] [--host ADDR] [--allow-remote]
```

This starts a local server (default `http://127.0.0.1:4173/`) showing the owner a
live preview of their site (the **candidate** copy, built annotated) next to a
pending-change panel. CLI flags override `owner-config.json` for that run.

- The owner clicks any highlighted element to edit text, swap an image, change a
  list line, or adjust a brand color — every change is validated and rebuilt into
  the candidate before it appears as a pending "old → new" card.
- The **Add…** menu lets the owner instantiate any of the developer-blessed
  blueprints (a new contact page, gallery page, or content page) as a new pending
  change, previewed the same way.
- **Approve** writes the change to the live `content.json` (+ any uploaded image),
  rebuilds the live site (no edit annotations), and runs the publish step (§5).
- **Discard** throws away the pending change and resets the candidate from live.
- **Restore** undoes the last published change (§7) and republishes.

Only one change is pending at a time — the owner approves or discards before making
the next edit. Nothing the owner does can write outside `clients/<client-name>/`,
and a failed candidate build can never become a pending change (§8 of SPEC.md).

**Image uploads are compressed in the browser.** When the owner picks a photo, the
editor scales it to at most 1920 px on the longest edge and re-encodes it (PNG →
WebP to keep transparency, everything else → JPEG) before uploading — so a 4 MB
phone photo lands as a few hundred KB without the owner doing anything. The
re-encode also strips EXIF metadata, including GPS position, which is a deliberate
privacy property. GIFs, files already under 300 KB, and anything the browser can't
decode are sent untouched; the server's upload guards (extension allowlist, size
cap, file-signature check) apply to the result either way.

**TESTING (manual browser checklist).** Canvas compression runs only in a real
browser, so it isn't covered by `npm test` — after touching the upload path, verify
once by hand in the editor (pick each file through any image field and check the
pending card's assigned `img/` path and the candidate preview):

- [ ] Large landscape JPEG (>1 MB): uploads as `.jpg`, lands well under the original
      size, looks sharp in the preview.
- [ ] Portrait phone photo (EXIF-rotated): orientation is upright in the preview,
      not sideways.
- [ ] PNG with transparency (>300 KB): uploads as `.webp`, transparency preserved
      against a colored background.
- [ ] GIF: uploads byte-identical with its original name (never re-encoded —
      animation survives).
- [ ] File under 300 KB: uploads byte-identical with its original name.
- [ ] iPhone HEIC selection (verify once on real hardware): iOS converts to JPEG at
      the file input, so it should behave like the JPEG case — confirm the upload is
      accepted and upright.

**Running it for the owner day to day:** this is a plain Node process — run it with
whatever process supervisor you're already comfortable with (a terminal left open,
`pm2`, a `systemd`/launchd unit, Task Scheduler, etc.) on a machine the owner can
reach at `http://<host>:<port>/`. The engine does not prescribe one; nothing about
it requires always-on hosting — the editor only needs to be running when the owner
wants to make a change, and the live site keeps serving from the host regardless.

---

## 7. Publish & rollback story

With the default `publish: "git"`:

- **Approve** runs `git add clients/<client-name>/content.json` (and `img/` if
  present), `git commit -m "<publishMessage>"`, then `git push`. The commit message
  embeds a marker, `[blockson-publish <client-name>]`.
- **Restore** finds the most recent commit carrying that marker, runs
  `git revert --no-edit` on it, rebuilds live + candidate, and pushes the revert.
  If `git` isn't installed, or no marked commit exists yet, Restore reports that in
  plain language and does nothing.
- Every step that can fail (no git, nothing to commit, push rejected) is reported to
  the owner without leaving `content.json` or the live build in a half-updated
  state — the local save and rebuild always succeed first, and only the push step
  can fail independently.

This means: **the repo's commit history on the connected branch IS the site's
revision history**, and the connected host (§4) redeploys on every push. Practically,
set this up so the owner's editor runs against a checkout that's on the branch your
host deploys from, with a remote already configured (`git remote -v` should show it)
and credentials that allow a non-interactive `git push` (an SSH key or a credential
helper — `serve.js` never prompts).

If you'd rather review every owner change before it goes live, point `publish` at a
branch-and-PR script instead of plain `git`, or set `publish: "none"` and redeploy
from `clients/<client-name>/content.json` changes yourself.

---

## 8. Contact form delivery

The `contact-form` block (see [BLOCK_CATALOG.md](BLOCK_CATALOG.md)) needs
something to receive its submissions. The blessed, subscription-free story is
per-host — pick the row that matches where the site is deployed:

| Host | Do this | What to deploy |
|---|---|---|
| **Netlify** | Set the block's `delivery` to `{ "mode": "netlify" }` | Nothing — Netlify's edge form handling picks the form up at deploy time; submissions appear under *Forms* in the Netlify dashboard (email notifications configurable there). Optional: `delivery.successPath` names your own thank-you page. |
| **Cloudflare** (Pages or any Cloudflare-DNS domain) | Keep the default endpoint mode; set `formAction` to the worker URL | The Worker in [`extras/cloudflare-form-worker/`](extras/cloudflare-form-worker/README.md) — a one-time, free deploy at handover. It emails submissions to the owner's **verified** address via Email Routing; the folder's README has the four setup steps in order. |
| **Anything else** | Keep endpoint mode; set `formAction` to an `https://` endpoint of your choosing | Your own endpoint, or a form relay service. Be explicit with yourself about the tradeoff: a free relay tier is a **dependency** (their uptime, their limits, their pricing changes), not a recommendation — it contradicts the no-service-relationship philosophy the rest of this system holds to. |

Either way, every rendered form carries a hidden honeypot field (`_gotcha`);
Netlify, the Worker, and common relays all drop submissions that fill it.

Until delivery is decided, set `formAction` to the documented placeholder
`https://UNCONFIGURED` — the site builds (so form delivery never blocks a
handover) and every build warns loudly until it's replaced.

---

## 9. The maintenance ledger (`edits.log.jsonl`)

Every attempt that flows through the owner editor's handlers — every edit,
blueprint instantiation, Approve, Discard, and Restore, whether it landed or was
refused — appends one JSON line to `clients/<client-name>/edits.log.jsonl`:

```json
{"at":"2026-06-10T18:04:11.392Z","event":"edit","request":{"patch":{"action":"set","block":"home-hero","field":"headline","value":"New headline."}},"outcome":"ok"}
```

- `event` is `edit | scaffold | approve | discard | restore`; `outcome` is
  `ok | rejected | build-failed`. Rejected lines carry the resolver's or
  validator's error **verbatim** in `error`.
- Image uploads are recorded by name and size only — file bytes never enter
  the ledger.
- The file is **gitignored by default** and never staged by the publish step:
  the git history already records what shipped; the ledger's unique value is
  the attempts that *didn't* — and those don't belong in a client-visible repo.
- Rotation: past 1 MB the file is renamed to `edits.log.1.jsonl` (replacing any
  previous one) and a fresh file starts. No other retention logic exists.
- Logging is a courtesy, not a control: if the ledger can't be written, the
  edit it describes still proceeds exactly as it would have.

**Harvesting it.** The rejected lines are roadmap data — what owners reached
for that the maintenance tier wouldn't do. When you next have access to the
machine running the editor, copy `clients/<client-name>/edits.log.jsonl` (and
`edits.log.1.jsonl` if present) and skim the refusals:

```
node -e "require('fs').readFileSync('clients/<client-name>/edits.log.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(l=>l.outcome!=='ok').forEach(l=>console.log(l.at,l.event,'-',l.error))"
```

When `publish` is `"none"`, the `ok` lines double as the local revision
history of what the owner accepted — the same file answers "what changed and
when" without a git log.

---

## 10. Troubleshooting

- **"the live content does not build — fix it before editing"** (on starting
  `serve.js`): `clients/<client-name>/content.json` already fails validation or the
  build. Fix it with `node engine/build.js <client-name>` until it builds clean,
  then start the editor again.
- **"This editor only accepts local requests."**: the request didn't come from
  loopback, or the `Host` header wasn't local/the configured `host`. Pass
  `--allow-remote` only on a trusted network — it disables this check entirely.
- **git errors during Approve/Restore**: the message names the failing git step
  (stage/commit/push/revert) verbatim. The candidate and live `content.json` are
  already saved and rebuilt at that point — only publishing needs retrying (e.g.
  `git push` by hand once the underlying issue, like a rejected push, is resolved).
- **A scaffolded page or edit doesn't appear**: check `node engine/sitemap.js
  <client-name>` — it prints the full edit map the editor and patch resolver agree
  on, which is useful for confirming a field or block id exists as expected.
