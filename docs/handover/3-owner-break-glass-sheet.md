# Step 3 — The owner's break-glass sheet

This is the **only** document the owner keeps. Fill in the blanks, print it, hand the
paper over, and also save a copy in the repo (e.g. `clients/<client-name>/HANDOVER.md`)
so it survives with the site. Everything below the line is written *to the owner*, in
plain language — keep it that way.

Its whole job: when the owner's computer dies, or they want a different developer, or
they just want to understand what they own, this page answers it **without anyone
having to call the person who set it up.** That's what makes the handover real.

---

# Your website — the important page

Keep this. It's everything you'd ever need to know about your site, in one place.

## What you actually own

Your website is **yours** — not rented from anyone. Three things make it up, and all
three are in **your** name:

- **Your web address (domain):** `______________________`
  Registered at: `______________________` (login is your email below).
  Renews for about $______/year — keep that card current and your address never lapses.

- **Your website's source** — the real thing your site is built from — lives here:
  `______________________` (a free GitHub account, login is your email).
  *Your computer is just a remote control. This is the actual website.*

- **Where it's hosted** (free, no monthly bill): `______________________`
  Dashboard: `______________________` (login is your email).

Your email on file for all of these: `______________________`

## How you change your site, day to day

1. Double-click **"`______________________`"** on your desktop.
2. Your site opens in a window. Click any text or photo to change it.
3. Each change shows you *before → after* so you can check it.
4. Click **Publish** when you're happy. Your live site updates in a minute or two.
5. Changed your mind about the last publish? Click **Restore** to undo it.

You can't break anything. The editor checks every change and refuses anything that
would harm the site, explaining why in plain English.

## If your computer dies or you get a new one

Your website is safe — it lives in "your website's source" above, not on the computer.
To get the editor back on a new machine, hand these three lines to **any** web
developer (it does not have to be the person who set this up):

> 1. Install Node.js (18+) and git.
> 2. `git clone` the repo at the source link above, then `npm install`.
> 3. Run `node engine/serve.js <client-name>` and make a desktop shortcut to it.

The editor is **free and open-source** — anyone can run it. You are not tied to any one
person:
`https://github.com/BradCL/blockson-2.0`

## Who to call

You don't *need* anyone — but if you want help with something the editor won't do
(see the next page), hire any web developer you trust. Nothing here is locked to a
single person.

Notes / who set this up: `______________________`

---

# What you can change yourself — and what needs a developer

*(This is OPERATOR.md §11, owner-facing. "Ask a developer" means any web developer —
you choose.)*

| You can, yourself | Needs a developer |
|---|---|
| Edit any text: headlines, paragraphs, prices, hours, names, captions | Add a new *kind* of section the site doesn't already have |
| Replace any photo (phone photos are fine — they're resized automatically) | Reorder sections or menu entries |
| Add, edit, or remove lines in plain lists (hours, service areas, "what's included") | Change fonts, sizes, spacing, or layout |
| Add or remove photos in a gallery album | Change text colors (they're matched to backgrounds for readability) |
| Change your brand colors (the editor blocks unreadable combinations) | Edit the footer columns, navigation order, or form fields |
| Hide a whole section and bring it back later (e.g. a booking section over winter) | Hide a whole page or its menu entry |
| Add whole new pages from the built-in layouts (contact, gallery, content page) | Add a page that doesn't match one of those layouts |
| Add a new card, FAQ entry, customer quote, or team member — and remove one (always keeps at least one) | Add/remove items in other lists (pricing plans, hours rows, process steps) |
| Preview every change before it goes anywhere, keep several, publish them together | Publish a change without previewing it first (by design) |
| Undo your last publish in one click | Recover something from longer ago (your full history is kept in the source) |

Every change is checked before it can go live. If the editor refuses something, it
tells you why in plain language — and hiring any developer is always a safe next step.
