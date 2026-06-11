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
