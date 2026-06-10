Blockson — End-to-End Workflow Walkthrough
The project is built around two distinct people with two distinct tiers of power, and the entire design exists to keep them separate:

The Developer (the "setup tier") — builds the site, picks the theme, writes the structure, connects it to a host, then hands over a locked-down editor. Full power: can write any file, any block, any structure.
The Owner (the "maintenance tier") — the business owner who later changes their hours, prices, photos, and wording. Deliberately constrained: can only edit existing content through a click-to-edit UI, can never break the structure, and can never write a file outside their own client folder.
The guiding invariant: a wrong write that lands is a safety failure; a rejected action is just a UX cost. Everything below is shaped by that.

ACT ONE — The Developer
Step 1 — Get the engine and confirm it's healthy
Purpose: You're starting from the shared engine repo. Before building anything client-specific, you confirm the engine itself is sound — the proof suite is the contract that every guard still holds.

What to do:


git clone <your repo>
cd blockson
npm install              # ajv + ajv-formats — the only deps, used for full schema validation
node engine/_run-proofs.js   # or: npm test  → expect "15/15 proofs passed"
If the proofs are green, every safety guard (patch resolver, candidate isolation, link-scheme guard, upload signatures, server request guards) is verified working.

Step 2 — Scaffold a new client
Purpose: Each business is a "client" — a single folder under clients/ holding only its content and images. The engine is shared; the client folder is the only thing that's bespoke. This step gives you a minimal, already-schema-valid starting point on a chosen theme, so you're never editing from a blank file.

What to do:


node engine/new-client.js smith-plumbing trades
First arg = client name (lowercase, digits, hyphens).
Second arg = theme preset (optional, defaults to default). Available themes: auto, childcare, clean, default, events, fitness, landscape, realty, restaurant, salon, trades, vet, warm.
This creates clients/smith-plumbing/content.json (a valid starter) and an empty clients/smith-plumbing/img/. It refuses to overwrite an existing client.

Step 3 — Add the brand assets
Purpose: The starter content.json references a handful of standard images. The build doesn't fetch anything remote (local-first invariant — no CDN, no remote fonts), so every asset must live in the client's own img/ folder.

What to do: Drop these into clients/smith-plumbing/img/:

logo-white.png, logo-black.png (nav/footer logos)
favicon.png
banner.jpg (hero background)
plus any photos your content blocks reference.
Step 4 — Author the content
Purpose: This is where the site actually takes shape. content.json is a list of pages, each page a list of blocks (hero, card-grid, pricing-table, team-grid, faq, hours-table, gallery, etc.). You're assembling pages from the block catalog — this is the structural work that is developer-only by design, because adding/removing/reordering blocks is exactly what the owner is never allowed to do later.

What to do:

Open clients/smith-plumbing/content.json.
Reference BLOCK_CATALOG.md for every block type and its exact fields.
Two ways to add a whole page:
Write blocks by hand in the JSON.
Instantiate a blueprint — pre-built page templates in blueprints/ (contact-page.json, content-page.json, gallery-page.json). These are the same templates the owner can later use self-serve. See BLUEPRINT_AUTHORING.md.
Key field rules enforced at build time: every href must be a safe scheme (https, http, mailto, tel, sms, #anchor, or relative — javascript:/data: are rejected); formAction and mapEmbedUrl must be https://.

If the site has a contact form, decide its delivery now — it's per-host and subscription-free (OPERATOR.md §8 "Contact form delivery"): on Netlify set the block's delivery to { "mode": "netlify" } and there's nothing to deploy; on Cloudflare deploy the one-time worker in extras/cloudflare-form-worker/ and point formAction at it; anywhere else, any https:// endpoint you choose. Not ready to decide? Set formAction to the placeholder https://UNCONFIGURED — the site builds and every build reminds you until it's real. Every form ships a hidden honeypot either way.

Step 5 — Build and validate
Purpose: The build is also the gate. It validates content.json against the JSON Schema first and writes nothing if validation fails — the error names the exact field path that's wrong. A site that builds is a site that's structurally sound.

What to do:


node engine/build.js smith-plumbing
Output lands in dist/smith-plumbing/ (which is gitignored — the repo holds source, the host runs the build). Iterate Step 4 ↔ Step 5 until it builds clean and looks right.

Step 6 — Configure the per-client editor behavior
Purpose: Before handing off, you decide how the owner's editor behaves — its display name, how it publishes changes, who the owner should call for anything beyond the editor, and what address/port it binds to. This is the dial between "owner changes go live automatically" and "I review everything first."

What to do: Create clients/smith-plumbing/owner-config.json (all keys optional):


{
  "clientName": "Smith Plumbing",
  "publish": "git",
  "contact": { "name": "Your Dev", "email": "dev@example.com" }
}
The critical key is publish:

"git" (default) — Approve runs git add/commit/push; the connected host redeploys. The owner's edits go live on their own.
"none" — saves and rebuilds locally only; you redeploy on your own schedule.
a custom shell command (with {message}/{client} placeholders) — e.g. hit a host's build-hook URL with curl.
Step 7 — Connect to a host
Purpose: This is what makes owner edits actually appear on the public internet. Because dist/ is gitignored, the host runs the build — so a git push of the owner's content change triggers a rebuild and redeploy with no manual step.

What to do (git-connected host like Netlify/Cloudflare Pages):

Setting	Value
Build command	npm install && node engine/build.js smith-plumbing
Publish directory	dist/smith-plumbing
For a plain static host (S3, GitHub Pages without Actions), use publish: "none", build locally, and upload dist/smith-plumbing/ yourself.

For the default publish: "git" to work end to end, the owner's editor must run against a checkout on the branch your host deploys, with a remote configured and credentials that allow a non-interactive git push (SSH key or credential helper — the editor never prompts).

Step 8 — Launch the editor and hand off
Purpose: You start the long-running editor process the owner will use. After this, you're done — the owner takes over the day-to-day, and the structural guarantees mean they can't hurt themselves or the site.

What to do:


node engine/serve.js smith-plumbing [--port N] [--host ADDR] [--allow-remote]
Defaults to http://127.0.0.1:4173/, loopback-only.
Run it under whatever supervisor you like (pm2, systemd, Task Scheduler, or just a terminal) on a machine the owner can reach. It only needs to be running when the owner wants to edit — the live site keeps serving from the host regardless.
Troubleshooting tool: node engine/sitemap.js smith-plumbing prints the exact edit map the editor and patch resolver agree on — useful for confirming a field/block id exists.

ACT TWO — The Owner
The owner never touches a file, a terminal, or JSON. Their entire world is one web page.

Step 1 — Open the editor
Purpose: The owner sees a live preview of their own site next to a pending-change panel. The preview is the candidate copy — a sandbox build, separate from what's live — so nothing they do touches the public site until they approve it.

What to do: Open http://127.0.0.1:4173/ (or whatever address the developer gave them) in a browser.

Step 2 — Click an element to edit it
Purpose: This is the core of the maintenance tier. Highlighted elements are the only things editable — text, an image, a list line, a brand color. The owner can't add or delete blocks, change structure, or break a layout, because those operations simply aren't offered. Hours and prices — the #1 real-world maintenance requests — are single id-addressed edits.

What to do: Click any highlighted element. Change the text, swap an image, edit a list line, or pick a new brand color. For photos, the owner just picks the file — a full-size phone photo is scaled and compressed in the browser before upload (orientation kept upright, location metadata stripped), and the server still validates it's a real image by its bytes, not just its name.

What happens under the hood: Every change goes through the patch resolver and is rebuilt into the candidate first. Only if that validated rebuild succeeds does it appear as a pending "old → new" card. A change that would fail validation can never even become a pending card.

Step 3 — (Optional) Add a whole new page
Purpose: The one structural thing the owner is trusted to do — but only along rails the developer pre-blessed. They can stand up a new page from a blueprint (a new contact, gallery, or content page), but only those vetted shapes, never freeform structure.

What to do: Use the Add… menu, pick a blueprint, fill in the inputs. It appears as a pending change, previewed exactly like an edit.

Step 4 — Approve, Discard, or Restore
Purpose: The owner makes the call on each pending change. Only one change is pending at a time — they resolve it before making the next, which keeps the mental model simple and the history clean.

What to do — pick one:

Approve → writes the change to the live content.json (+ any uploaded image), rebuilds the live site (no edit annotations), and runs the publish step. With publish: "git", this commits and pushes; the host redeploys; the change is live in minutes.
Discard → throws the pending change away and resets the candidate from live. No trace.
Restore → undoes the last published change. It finds the most recent commit carrying the [blockson-publish <client>] marker, reverts it, rebuilds, and re-pushes.
Safety guarantee: the local save and rebuild always succeed first; only the independent push step can fail, and if it does, the owner gets a plain-language message — never a half-updated site.

The shape of it, in one picture

DEVELOPER (setup tier — full power, one-time)
  new-client → add assets → author blocks/blueprints → build/validate
            → owner-config → connect host → launch serve.js ──┐
                                                               │ hands off
OWNER (maintenance tier — constrained, ongoing) ◄─────────────┘
  open editor → click to edit (→ candidate sandbox) → pending card
            → Approve (→ live + git push → host redeploys)
                       Discard / Restore as needed
The line between the two acts is the whole point: the developer's structural power is exercised once and then sealed off, and the owner is handed a tool where the dangerous operations don't exist rather than being merely discouraged. The candidate/live split, the patch resolver, the schema gate, and the loopback-only server are the four walls that make that hand-off safe.