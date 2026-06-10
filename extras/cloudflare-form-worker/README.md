# Cloudflare form worker

A tiny, dependency-free Cloudflare Worker that turns the `contact-form` block's
POST into a plain-text email to the site owner, using Cloudflare **Email
Routing** — no form-relay subscription, no monthly fee, no third party holding
the messages. Deploy it once at handover; it then runs unattended on
Cloudflare's free tier.

**The constraint, in plain language:** Email Routing sends free email **only to
destination addresses the owner has verified** on the Cloudflare account. That
is exactly the contact-form case — the site's own owner receiving their own
enquiries — and exactly why this needs no paid service. It cannot be used to
mail arbitrary addresses, and that's a feature.

This folder is a deploy-time artifact: the engine never imports anything from
`extras/` (the proof suite checks that). `worker.js` uses only the Workers
runtime API — no npm packages, no bundler.

## One-time setup (in order)

1. **Enable Email Routing on the domain.** Cloudflare dashboard → the site's
   zone → *Email* → *Email Routing* → enable. The domain's DNS must be on
   Cloudflare (it already is if the site is on Cloudflare Pages).
2. **Verify the owner's destination address.** *Email Routing → Destination
   addresses* → add the owner's real inbox → owner clicks the verification
   email. Sending only works to verified destinations.
3. **Deploy the worker.** Copy this folder somewhere outside the site repo if
   you prefer, edit `wrangler.toml`:
   - `destination_address` and `MAIL_TO` → the verified address from step 2
   - `MAIL_FROM` → any mailbox name on the routed domain (e.g.
     `forms@their-domain.com`)
   - `THANKS_PATH` → where the visitor lands after submitting (e.g.
     `/thanks.html`, or leave `/`)
   - `ALLOWED_FIELDS` → the form's field names, if they differ from the
     default `name,email,phone,message,_subject`

   then:

   ```
   npx wrangler deploy
   ```

   Wrangler prints the worker URL (e.g.
   `https://blockson-form-worker.<account>.workers.dev`). You can also bind a
   route on the site's own domain (e.g. `their-domain.com/api/contact`) from
   the dashboard if you'd rather not expose a workers.dev URL.
4. **Point the form at it.** In the client's `content.json`, set the
   contact-form block's `formAction` to the worker URL (it must be `https://`,
   which a worker URL always is). Rebuild/publish — done.

## What the worker does

- Accepts `POST` form data only; any other method gets `405`.
- Caps the body at 32 KB and whitelists the expected field names — anything
  else is ignored.
- Drops submissions where the hidden honeypot field (`_gotcha`, rendered by
  the contact-form block automatically) is filled — and answers the bot with
  the **same success redirect** a human gets, so it never learns it was caught.
- Builds a plain-text email from the whitelisted fields (the form's
  `subjectLine` travels as the email subject, newline-stripped so user input
  can never inject headers) and sends it through the `SEND_EMAIL` binding.
- Responds `303 See Other` to `THANKS_PATH`.

Sender and recipient come from `wrangler.toml` vars — nothing is hardcoded in
`worker.js`.
