'use strict';

const { esc } = require('../lib/escape');

// Honeypot field name. "_gotcha" is Formspree's reserved honeypot field, so
// endpoint-mode relays that recognise it drop bot submissions with no extra
// setup; the same name is wired into netlify-honeypot below and into the
// Cloudflare Worker template (extras/cloudflare-form-worker/). The input is
// rendered markup, never schema content — it must never appear in the edit
// map and never carry a data-bk-* annotation.
const HONEYPOT_NAME = '_gotcha';

function renderField(f) {
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
        <label for="field-${esc(f.name)}">${esc(f.label)}${reqMark}</label>
        ${input}
      </div>`;
}

module.exports = function contactForm(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const subject = fields.subjectLine
    ? `<input type="hidden" name="_subject" value="${esc(fields.subjectLine)}"${bk.f('subjectLine')}>` : '';
  const submitLabel = fields.submitLabel || 'Send Message';

  // Delivery mode (optional, additive — see BLOCK_CATALOG.md / OPERATOR.md
  // "Contact form delivery"). Absent or "endpoint": the classic POST to an
  // https:// formAction, rendered exactly as before. "netlify": render the
  // attributes Netlify's edge form handling picks up at deploy time instead;
  // formAction, if present, is not rendered in this mode.
  const delivery = (fields.delivery && typeof fields.delivery === 'object') ? fields.delivery : {};
  let formOpen;
  let netlifyName = '';
  if (delivery.mode === 'netlify') {
    const formName = delivery.formName || 'contact';
    // The success redirect: a configured relative path renders as the form
    // action so Netlify redirects there after a submission; without one,
    // Netlify's built-in success page answers the POST.
    const action = delivery.successPath ? ` action="${esc(delivery.successPath)}"` : '';
    formOpen = `<form class="contact-form" method="POST" name="${esc(formName)}" data-netlify="true" netlify-honeypot="${HONEYPOT_NAME}"${action}>`;
    netlifyName = `<input type="hidden" name="form-name" value="${esc(formName)}">\n      `;
  } else {
    formOpen = `<form class="contact-form" method="POST" action="${esc(fields.formAction)}"${bk.f('formAction')}>`;
  }

  // Visually hidden honeypot, rendered in BOTH modes: offscreen via
  // .form-hp, hidden from assistive tech, and not focusable — only a bot
  // that fills every field touches it. Netlify, the Worker template, and
  // Formspree all drop submissions where it is filled.
  const honeypot = `${netlifyName}<div class="form-hp" aria-hidden="true"><input type="text" name="${HONEYPOT_NAME}" tabindex="-1" autocomplete="off"></div>`;

  // Group half-width fields into rows
  const formFields = fields.fields || [];
  const rows = [];
  let i = 0;
  while (i < formFields.length) {
    const f = formFields[i];
    if (f.half && i + 1 < formFields.length && formFields[i + 1].half) {
      rows.push(`<div class="form-row">${renderField(f)}${renderField(formFields[i + 1])}</div>`);
      i += 2;
    } else {
      rows.push(renderField(f));
      i++;
    }
  }

  return `<section class="contact-form-section">
  <div class="container">
    ${tag}
    ${heading}
    ${formOpen}
      ${subject}
      ${honeypot}
      ${rows.join('\n      ')}
      <div class="form-submit">
        <button type="submit" class="btn btn-primary"${bk.f('submitLabel')}>${esc(submitLabel)}</button>
      </div>
    </form>
  </div>
</section>`;
};
