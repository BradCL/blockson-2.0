# Step 2b — Install field card (copy-paste)

The exact commands for [`2-install-runbook.md`](2-install-runbook.md), in order, with
nothing left to compose on the day. The runbook explains *why*; this is *what to type*.

- Host assumed: **Netlify** (git-connected). Commands are **PowerShell**.
- Replace everywhere: `<client>` = the client folder name (e.g. `north-fencing`);
  `<client-account>/<repo>` = their GitHub repo (e.g. `NorthFencing/north-site`).
- Everything here is **your** job. The owner watches; they don't type.

---

## Before you arrive — Step 1 must already be GREEN

Don't start the install until all of these are true (from
[`1-account-setup.md`](1-account-setup.md)). These are the slow, account-juggling parts
— do them ahead so the on-site session is only the fast part.

- [ ] Domain registered to the client; DNS pointed at Netlify; HTTPS serving.
- [ ] Repo under the **client's** GitHub account; you're a (removable) collaborator.
- [ ] Netlify site under the **client's** account, connected to their repo, **building
      green**, with:
      | Setting | Value |
      |---|---|
      | Build command | `npm install && node engine/build.js <client>` |
      | Publish directory | `dist/<client>` |
- [ ] Contact form delivers to **their** inbox: block `delivery` = `{ "mode": "netlify" }`,
      and a test submission has landed under **Forms** in their Netlify dashboard (email
      notifications set to their address). Or `https://UNCONFIGURED` on purpose if no form yet.
- [ ] `clients/<client>/owner-config.json` set — `clientName`, and `publish` (see §B vs the
      fallback at the bottom).

---

## A. Runtime + repo (≈5 min, owner watches)

```powershell
# Node 20+ and git installed (the .msi installers — next-next-finish). Then:
git clone git@github.com:<client-account>/<repo>.git
cd <repo>
npm install
node engine/_run-proofs.js      # engine is healthy
node engine/build.js <client>   # content.json valid → writes dist/<client>/
```

A clean build means the editor will start. If `build.js` errors, it names the exact
field path — fix `content.json`, don't proceed past a red build.

---

## B. Push credential — the deploy key (the one genuinely fiddly step)

This is the step you'd otherwise google. Goal: a key scoped to **this one repo** that
lets the editor's **Publish** run `git push` with **no prompt, ever**. Do it once, here.

```powershell
# 1. Generate a dedicated keypair for THIS repo.
#    When prompted for a passphrase, press Enter TWICE (empty — required so Publish
#    never stops to ask for one).
ssh-keygen -t ed25519 -C "blockson-<client>" -f "$env:USERPROFILE\.ssh\blockson_<client>"

# 2. Print the PUBLIC key and copy it:
Get-Content "$env:USERPROFILE\.ssh\blockson_<client>.pub"
```

In GitHub: **the client's repo → Settings → Deploy keys → Add deploy key** → paste the
public key → title it `owner PC` → **tick "Allow write access"** → Add.

```powershell
# 3. Point THIS repo at the SSH URL and tell git to use ONLY this key, scoped to the
#    repo (no global ~/.ssh/config edits — important on a machine that already has
#    other keys, like yours during a rehearsal):
git remote set-url origin git@github.com:<client-account>/<repo>.git
git config core.sshCommand "ssh -i ~/.ssh/blockson_<client> -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

# 4. Prove a NON-INTERACTIVE push works (this is the whole test):
git commit --allow-empty -m "handover: verify push"
git push
```

If that pushes silently, the owner's Publish will too. Why each flag matters:
- `IdentitiesOnly=yes` + explicit `-i` → git offers *only* this deploy key, so other
  keys on the machine can't shadow it. This is what makes it behave the same on a clean
  owner PC and on your multi-account machine.
- `StrictHostKeyChecking=accept-new` → auto-accepts github.com's host key on first
  connect, so a non-interactive push never hangs on the "authenticity of host" prompt.
- Empty passphrase → `git push` never stops to ask for one.

> **Branch gotcha:** the editor pushes the **current** branch. Make sure `git branch`
> shows the branch Netlify deploys from (its production branch — usually `main`/`master`),
> or Publish will push to a branch the host isn't watching.

---

## C. One-click launcher

```powershell
# From extras/owner-launcher/, copy both files to the repo ROOT (next to engine\):
Copy-Item extras\owner-launcher\editor-launcher.ps1 .\
Copy-Item "extras\owner-launcher\Edit My Site.vbs" .\
```

Then:
1. Open `Edit My Site.vbs`, set the marked line to the client folder:
   `client = "<client>"` (it ships as `client = "CLIENT_NAME_HERE"`).
2. Right-click `Edit My Site.vbs` → **Send to → Desktop (create shortcut)**.
3. Rename the shortcut to something the owner recognizes; **Properties → Change Icon**.
4. Double-click it — the editor opens in a clean app window. (Port defaults to 4173;
   override via `port` in `owner-config.json` if needed.)

---

## D. Verify the whole loop — in front of the owner

Don't leave until you've watched this work on **their** machine and **their** domain:

1. Double-click the launcher → editor opens.
2. Make a trivial real edit (one word in a headline) → **Keep** → **Publish**.
3. Watch Netlify rebuild (give it its build minute) and the change appear on the **live
   domain**.
4. Click **Restore** → the change rolls back and republishes. Confirm live.

Local save always succeeds; only the push can fail independently. If Publish fails,
it's the credential — redo §B. (See OPERATOR.md §10.)

---

## E. Walk away (the part that makes it real)

1. Walk the owner through clicking the launcher and making **one edit themselves**.
2. Fill in, print, and save the **break-glass sheet**
   ([`3-owner-break-glass-sheet.md`](3-owner-break-glass-sheet.md)); also save a copy as
   `clients/<client>/HANDOVER.md`.
3. Have the client **remove your collaborator access** on the repo and Netlify (do it
   together). Confirm the site still serves and the launcher still publishes afterward.

Before you close the door, all four must be **yes**:
- [ ] Their accounts deleted tonight → site still serves and still publishes? (Theirs → yes.)
- [ ] Their PC dies → they/any tech rebuild from the break-glass sheet without you?
- [ ] Domain registered to **them**, renewable without you?
- [ ] Form delivers to **their** inbox via **their** host?

---

## If the deploy key fights you in the room — graceful fallback

Per [Step 1 §6](1-account-setup.md#L92), `publish: "none"` is the sanctioned
training-wheels mode. If §B won't cooperate live, **don't burn the session
debugging SSH in front of the owner** — degrade gracefully:

1. Set `clients/<client>/owner-config.json` → `"publish": "none"`.
2. The editor still saves, previews, and rebuilds locally — the owner experience is
   identical except the **Publish** button doesn't push. They edit with full confidence.
3. You wire the deploy key (§B) and flip `publish` back to `"git"` on your own time, calm,
   then confirm a real Publish — and *that's* when you've truly walked away.

This keeps the owner's experience clean no matter what the credential does.

---

## Rehearse this card solo first (do this before the meeting)

Run the whole card once against a **throwaway repo that's yours and deletable** so your
hands know it cold:

1. Create a **private** repo under your own GitHub (stand-in for "the client's repo").
2. Make a throwaway client folder: `node engine/new-client.js rehearsal` and build it.
3. Push the repo, connect a free Netlify site to it (build/publish settings above).
4. Run §A–§D top to bottom — **especially §B**, so the deploy-key dance is muscle memory.
   `IdentitiesOnly=yes` keeps it from touching your existing keys.
5. Delete the repo, the Netlify site, and `~/.ssh/blockson_rehearsal*` when done.

The deploy key (§B) and the live-rebuild leg (§D) are the only two steps you haven't
done before — rehearse those twice and there's nothing left to google.
