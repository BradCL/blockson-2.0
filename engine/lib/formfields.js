'use strict';

/* ============================================================
   engine/lib/formfields.js — the shared lead-form renderer

   One implementation of every part of a form that must not drift
   between the blocks that render one: field markup and its escaping,
   the half-width row grouping, the delivery contract (endpoint vs
   netlify), the honeypot, and the origin tag. `contact-form` and
   `hero-form` both render through here, so a form in a hero and the
   form on the contact page are literally the same form — which is
   what an owner asking for "the same one" means, and what keeps ONE
   escaping path and ONE honeypot rather than two of each that have to
   be kept in step by hand.

   ANNOTATION PATHS are prefixed, because the same form spec lives at
   the block root in contact-form (`subjectLine`) and one level down in
   hero-form (`form.subjectLine`). The edit map reports each shape
   accordingly — a dotted scalar is annotatable but not
   annotation-REQUIRED (see engine/lib/annotate.js COVERAGE SCOPE), so
   both are consistent with proof 1 without either block special-casing
   anything.

   INDENTATION is a parameter for one reason: contact-form's output must
   stay byte-identical through this extraction, so its historical 6/8/4
   spacing is the default. A block that nests its form deeper passes its
   own base so view-source stays readable.
   ============================================================ */

const { esc } = require('./escape');

// Honeypot field name. "_gotcha" is Formspree's reserved honeypot field, so
// endpoint-mode relays that recognise it drop bot submissions with no extra
// setup; the same name is wired into netlify-honeypot below and into the
// Cloudflare Worker template (extras/cloudflare-form-worker/). The input is
// rendered markup, never schema content — it must never appear in the edit
// map and never carry a data-bk-* annotation.
const HONEYPOT_NAME = '_gotcha';

const pad = (n) => ' '.repeat(n < 0 ? 0 : n);

function renderField(f, base) {
  const inner    = pad(base + 2);
  const close    = pad(base);
  const req      = f.required ? ' required' : '';
  const phAttr   = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const reqMark  = f.required
    ? ' <span class="form-required" aria-hidden="true">*</span>'
    : ' <span class="form-optional">(optional)</span>';

  let input;
  if (f.type === 'textarea') {
    input = `<textarea name="${esc(f.name)}" id="field-${esc(f.name)}"${phAttr}${req} rows="6"></textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    input = `<select name="${esc(f.name)}" id="field-${esc(f.name)}"${req}><option value="">Select…</option>${opts}</select>`;
  } else {
    input = `<input type="${esc(f.type)}" name="${esc(f.name)}" id="field-${esc(f.name)}"${phAttr}${req}>`;
  }

  return `<div class="form-group">
${inner}<label for="field-${esc(f.name)}">${esc(f.label)}${reqMark}</label>
${inner}${input}
${close}</div>`;
}

// Group half-width fields into rows: two ADJACENT half fields share a row.
function renderRows(list, base) {
  const rows = [];
  let i = 0;
  while (i < list.length) {
    const f = list[i];
    if (f.half && i + 1 < list.length && list[i + 1].half) {
      rows.push(`<div class="form-row">${renderField(f, base)}${renderField(list[i + 1], base)}</div>`);
      i += 2;
    } else {
      rows.push(renderField(f, base));
      i++;
    }
  }
  return rows;
}

/* Render one complete <form> element from a form spec.

   `spec` carries formAction / delivery / subjectLine / submitLabel /
   source / fields — the same shape wherever it lives. `bk` is the block's
   annotator and `prefix` the path its fields sit behind ('' at a block
   root, 'form.' when nested). `className` is the form's class list, so a
   block can hang its own styling hook off the shared markup. */
function renderForm(spec, bk, opts) {
  const o         = opts || {};
  const prefix    = o.prefix || '';
  const className = o.className || 'contact-form';
  const base      = typeof o.indent === 'number' ? o.indent : 6;
  const body      = pad(base);
  const inner     = pad(base + 2);
  const closeForm = pad(base - 2);
  const at        = (field) => bk.f(prefix + field);

  const subject = spec.subjectLine
    ? `<input type="hidden" name="_subject" value="${esc(spec.subjectLine)}"${at('subjectLine')}>` : '';
  const submitLabel = spec.submitLabel || 'Send Message';

  // Delivery mode (optional, additive — see BLOCK_CATALOG.md / OPERATOR.md
  // "Contact form delivery"). Absent or "endpoint": the classic POST to an
  // https:// formAction, rendered exactly as before. "netlify": render the
  // attributes Netlify's edge form handling picks up at deploy time instead;
  // formAction, if present, is not rendered in this mode.
  const delivery = (spec.delivery && typeof spec.delivery === 'object') ? spec.delivery : {};
  let formOpen;
  let netlifyName = '';
  if (delivery.mode === 'netlify') {
    const formName = delivery.formName || 'contact';
    // The success redirect: a configured relative path renders as the form
    // action so Netlify redirects there after a submission; without one,
    // Netlify's built-in success page answers the POST.
    const action = delivery.successPath ? ` action="${esc(delivery.successPath)}"` : '';
    formOpen = `<form class="${className}" method="POST" name="${esc(formName)}" data-netlify="true" netlify-honeypot="${HONEYPOT_NAME}"${action}>`;
    netlifyName = `<input type="hidden" name="form-name" value="${esc(formName)}">\n${body}`;
  } else {
    formOpen = `<form class="${className}" method="POST" action="${esc(spec.formAction)}"${at('formAction')}>`;
  }

  // Visually hidden honeypot, rendered in BOTH modes: offscreen via
  // .form-hp, hidden from assistive tech, and not focusable — only a bot
  // that fills every field touches it. Netlify, the Worker template, and
  // Formspree all drop submissions where it is filled.
  const honeypot = `${netlifyName}<div class="form-hp" aria-hidden="true"><input type="text" name="${HONEYPOT_NAME}" tabindex="-1" autocomplete="off"></div>`;

  // Origin tag (optional, developer-tier, rendered in BOTH delivery modes).
  // Once a site has two forms, the owner needs to know which one fired — the
  // attribution a marketing company reads to tell a hero lead from a
  // contact-page enquiry. The alternative is giving each form its own
  // delivery.formName, which splits them into two inboxes with two
  // notification configs, and a missed notification is a missed lead.
  // Like the honeypot above, this is rendered markup rather than editable
  // content: no bk annotation, and absent from the edit map + refused by
  // applyPatch (patch.js DEVELOPER_ONLY_FIELDS), because an owner who
  // retargets it breaks attribution invisibly. Escaped like every other
  // value; omitted entirely when unset, so a form that does not set it is
  // byte-identical to a pre-`source` build.
  const source = spec.source
    ? `<input type="hidden" name="source" value="${esc(spec.source)}">\n${body}` : '';

  const rows = renderRows(spec.fields || [], base);

  return `${formOpen}
${body}${subject}
${body}${source}${honeypot}
${body}${rows.join('\n' + body)}
${body}<div class="form-submit">
${inner}<button type="submit" class="btn btn-primary"${at('submitLabel')}>${esc(submitLabel)}</button>
${body}</div>
${closeForm}</form>`;
}

module.exports = { HONEYPOT_NAME, renderField, renderRows, renderForm };
