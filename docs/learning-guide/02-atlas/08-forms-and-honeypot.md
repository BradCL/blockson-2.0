# Atlas 08 — Forms and the honeypot

## In class you learned…

`<form method="POST" action="...">`, `<input name="...">`, `required`,
and that a submit sends the named fields to the action URL. Maybe a
server route that reads them.

## In Blockson it lives at…

`engine/blocks/contact-form.js` — the renderer that turns a
`contact-form` block's `fields` into a working form. It's the most
interesting block module because the *form itself is generated from
data*: the JSON lists the fields, and `renderField` writes each one.

## A guided read-through

`renderField` is data-driven form generation in one function:

```js
if (f.type === 'textarea') {
  input = `<textarea name="${esc(f.name)}" id="field-${esc(f.name)}"${phAttr}${req} rows="6"></textarea>`;
} else if (f.type === 'select') {
  const opts = (f.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  input = `<select name="${esc(f.name)}" id="field-${esc(f.name)}"${req}><option value="">Select…</option>${opts}</select>`;
} else {
  input = `<input type="${esc(f.type)}" name="${esc(f.name)}" id="field-${esc(f.name)}"${phAttr}${req}>`;
}
```

Notice the accessibility pairing you may have skipped in class: every
input gets an `id`, and the `<label>` points at it with
`for="field-${name}"` — that's what makes clicking the label focus the
field, and what screen readers announce. Notice also `esc(...)` around
*every* interpolated value, including attribute values — the escaping
chapter of the [security mindset](13-security-mindset.md).

**Where do submissions go?** A static site has no server of its own, so
the block supports two delivery modes (the `delivery` object in the
block's fields):

- **endpoint** (default): `method="POST" action="${fields.formAction}"` —
  a real URL, schema-enforced to be `https://` (`HTTPS_ONLY_KEYS` in
  `engine/lib/validate.js`), typically the Cloudflare Worker shipped in
  `extras/cloudflare-form-worker/`.
- **netlify**: render `data-netlify="true"` and a hidden `form-name`
  input instead — Netlify's host intercepts the POST at its edge.
  No `formAction` needed; the schema makes it optional *only* in this
  mode (proof 15 pins that down).

**The honeypot.** Both modes render this:

```js
const HONEYPOT_NAME = '_gotcha';
...
const honeypot = `${netlifyName}<div class="form-hp" aria-hidden="true"><input type="text" name="${HONEYPOT_NAME}" tabindex="-1" autocomplete="off"></div>`;
```

A honeypot is an *invisible* text field. The CSS class `.form-hp` moves it
offscreen; `aria-hidden="true"` hides it from screen readers;
`tabindex="-1"` keeps keyboard users from landing in it. A human can't
fill it. Spam bots, which typically fill every named field they find,
do — and the receiving endpoint silently drops any submission where
`_gotcha` has a value. The name `_gotcha` is Formspree's reserved
honeypot field, so common relays honor it with zero configuration; the
same name is wired into `netlify-honeypot="..."` and the shipped Worker.

> **Term: honeypot.** A trap that's invisible to legitimate users but
> attractive to automated abuse — here, a form field only a bot would
> fill. Spam defense with no CAPTCHA, no JavaScript, no user friction.

## What production adds

- **Spam is a launch-day certainty,** not an edge case. Any form on the
  public internet gets bot traffic within days. The classroom form has no
  defense; the production form ships one *by default*, in every mode.
- **Layout logic in the renderer.** Fields marked `half: true` are paired
  into rows (the `while` loop in the module) — with a documented decision
  for the odd-one-out case (README's "Spec-silent choices" table: a last
  unpaired half-width field renders full width). Production code writes
  down its tie-breaks.
- **The unconfigured state is designed.** `formAction` defaults to the
  placeholder `https://UNCONFIGURED` — it passes the https guard so the
  site builds, and `warnOnPlaceholderForms` in `engine/build.js` warns
  loudly on every build until it's replaced. Compare the classroom
  pattern of an empty `action=""` that fails silently in production.
- **The honeypot is markup, never data.** The comment in the module is
  emphatic: the honeypot "must never appear in the edit map and never
  carry a `data-bk-*` annotation." It isn't part of the content model —
  the owner can't edit it, see it, or break it — and proof 15 asserts the
  annotation absence.

## Why here, why this way

The form block is where Blockson's "no subscriptions, no maintenance"
promise meets reality: email delivery normally means a paid service. The
two delivery modes are the engineered answer — a free Worker you deploy
once, or the host's native handling — and the honeypot is what makes
"unattended for years" survivable. Notice the division of labor: the
*block* renders the same honeypot everywhere, the *endpoint* decides what
to do about it. Each layer does the part only it can do.

---

## Try it

**Exercise 1 (predict, then verify).** The scratch client has no contact
form, so use the read-only canonical example. *Question:* in the built
contact page of example-contractor, how many times does the honeypot
field name `_gotcha` appear, and does it ever carry a `data-bk-*`
annotation in the annotated build? **Predict, then check:**

```
node engine/build.js example-contractor
node engine/build.js example-contractor --annotate
```

then search `dist/example-contractor/contact.html` and
`dist/example-contractor__annotated/contact.html` for `_gotcha`.

<details><summary>What you should see</summary>

One `<input type="text" name="_gotcha" tabindex="-1" autocomplete="off">`
inside a `class="form-hp" aria-hidden="true"` wrapper - in both builds,
never annotated. The honeypot is rendered markup, not content: owners
can't see it, click it, or break it. (Proof 15 asserts exactly
this.)</details>

**Exercise 2 (modification, safe).** Give learning-lab a contact form:
add to the contact page's `blocks` array a
`{ "id": "contact-form", "type": "contact-form", "fields": { ... } }`
block, copying `fields` from example-contractor's contact page and
keeping `"formAction": "https://UNCONFIGURED"`. Build. *Predict first:*
does the placeholder fail the build, or warn?

<details><summary>What you should see</summary>

The build succeeds and prints the long warning naming your block id and
explaining that submissions will go nowhere until `formAction` is real -
`warnOnPlaceholderForms` in `engine/build.js`. Advisory, not
gate.</details>

## Self-check

1. Why is the honeypot named `_gotcha` specifically?
   <details><summary>Answer</summary>It's Formspree's reserved honeypot
   field name, so endpoint-mode relays that recognise it drop bot
   submissions with no configuration; the same name is wired into the
   netlify-honeypot attribute and the shipped Cloudflare
   Worker.</details>
2. Which three attributes hide the honeypot from humans without hiding
   it from bots?
   <details><summary>Answer</summary>The offscreen `.form-hp` CSS class,
   `aria-hidden="true"` (assistive tech), and `tabindex="-1"`
   (keyboard). Bots parsing HTML still see a named text input.</details>
3. In netlify mode, what happens to `formAction`?
   <details><summary>Answer</summary>It isn't rendered - the form gets
   Netlify's attributes instead, and the schema makes `formAction`
   optional only in that mode.</details>
4. Transfer: a client reports "we get spam anyway." The honeypot is
   rendering. Where does the fix belong?
   <details><summary>Answer</summary>At the receiving endpoint - the
   block can only mark submissions; the endpoint (Worker, relay,
   Netlify) is what must drop those where `_gotcha` is filled, so check
   its configuration first.</details>
