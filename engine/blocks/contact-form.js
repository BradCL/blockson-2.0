'use strict';

const { esc } = require('../lib/escape');

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

module.exports = function contactForm(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';
  const subject = fields.subjectLine
    ? `<input type="hidden" name="_subject" value="${esc(fields.subjectLine)}">` : '';
  const submitLabel = fields.submitLabel || 'Send Message';

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
    <form class="contact-form" method="POST" action="${esc(fields.formAction)}">
      ${subject}
      ${rows.join('\n      ')}
      <div class="form-submit">
        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
      </div>
    </form>
  </div>
</section>`;
};
