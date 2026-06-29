# Step 1 — Accounts first (everything in the client's name)

Do this **before** you build anything. It's the step that decides whether you can
truly walk away. Every account here is a **free tier** — there is no subscription for
you or the client; replacing that subscription is the whole pitch.

The rule: **you are a configurator with temporary access, never an owner.** Each
account below is created by (or transferred to) the client, with their email and their
payment method on file where one is needed (only the domain costs money). You get
collaborator/admin access to do the work, and that access is *revocable by them*.

## 1. Domain — registered to the client

- Register the domain (or transfer their existing one) under **the client's own
  registrar account**, paid with **their** card. ~$10–15/yr is the only true cost in
  this whole stack; don't bury it in your account "to be helpful" — that's the
  classic string.
- If they already have a domain stuck inside Wix/Squarespace/GoDaddy, plan the
  transfer or just re-point its DNS (you don't always need to move the registration,
  only the DNS records).
- You'll point its DNS at the host in Step 3 below.

## 2. Git repo — the client's account

The repo **is** the website. Whoever owns the repo owns the site's source and its
entire revision history (Publish/Restore in the editor is git underneath — see
OPERATOR.md §7).

- Create the repo under **the client's** GitHub/GitLab account (make them one if
  needed — free). Add yourself as a collaborator to do the setup.
- Put the engine + their `clients/<name>/` folder in it. A clean way: fork the public
  engine into their account, then add their client folder. Either keep the engine
  inline, or track upstream — your call, but the result must be a repo *they* hold.
- **Do not** create it under your account "for now." There is no "for now" in a
  walk-away model.
- When you leave, the client (or you, as a courtesy) removes you as a collaborator.
  Nothing breaks — the deploy runs off the repo, not off your access to it.

## 3. Static host — the client's account, connected to their repo

Free, git-connected static hosting is what serves the live site and rebuilds on every
Publish. Two good choices:

- **Cloudflare Pages** (free) — also gives you Cloudflare DNS + the email-form path
  (see §5).
- **Netlify** (free) — also gives you built-in form handling (see §5).

Create the host account under **the client's** email, connect it to **their** repo
from §2, and configure (per OPERATOR.md §4):

| Setting | Value |
|---|---|
| Build command | `npm install && node engine/build.js <client-name>` |
| Publish directory | `dist/<client-name>` |

Now every push to the connected branch rebuilds and redeploys — which is exactly what
the owner's **Publish** button triggers, with no manual deploy step from anyone.

## 4. Point the domain at the host

In the client's registrar/DNS (from §1), add the records the host tells you to
(usually a CNAME/ALIAS to the host, or Cloudflare's nameservers). Verify the custom
domain serves the built site over HTTPS before moving on.

## 5. Contact-form delivery — to the client's own inbox

A `contact-form` block needs somewhere to send submissions, and in a walk-away model
that destination must **not** route through any account of yours (see OPERATOR.md §8).
Pick the row that matches the host you chose:

| Host | Set in `content.json` | Delivery |
|---|---|---|
| **Netlify** | block `delivery` → `{ "mode": "netlify" }` | Submissions land in **their** Netlify dashboard; configure email notifications to **their** address there. |
| **Cloudflare** | endpoint mode; `formAction` → the worker URL | Deploy the worker in [`extras/cloudflare-form-worker/`](../../extras/cloudflare-form-worker/README.md) under **their** Cloudflare account; it emails submissions to **their** verified address via Email Routing. |

Avoid free third-party form relays here — a relay is a service dependency in someone's
name (and if it's yours, you never left). Until delivery is wired, the documented
placeholder `https://UNCONFIGURED` keeps the site building and warns on every build.

## 6. Per-client editor config

In `clients/<client-name>/owner-config.json` (OPERATOR.md §5), set at least:

```json
{
  "clientName": "Their Business Name",
  "publish": "git",
  "contact": { "name": "Their own notes / a developer of their choosing", "email": "..." }
}
```

- Keep `publish: "git"` for true self-service (owner clicks Publish → it ships).
- Consider `publish: "none"` for **client #1 only**, as training wheels: the owner
  edits and previews locally, you do the deploy on their ping, and you graduate them
  to `"git"` once you trust the flow.
- The `contact` block shows the owner "who to call for anything beyond this editor."
  In a walk-away model, point it at *themselves* or "any web developer" — not a
  standing promise from you.

## Done when

- [ ] Domain registered to the client, DNS pointing at their host, HTTPS live.
- [ ] Repo under the client's account; you're a (removable) collaborator.
- [ ] Host under the client's account, connected to their repo, building green.
- [ ] Contact form delivers to the client's own inbox (or `UNCONFIGURED` on purpose).
- [ ] `owner-config.json` set.

Now go install — [`2-install-runbook.md`](2-install-runbook.md).
