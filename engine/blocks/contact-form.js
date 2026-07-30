'use strict';

// contact-form — a full-width contact form with a selectable, subscription-free
// delivery mode. Everything about the form itself (field markup, half-width
// rows, delivery, honeypot, the origin tag) lives in engine/lib/formfields.js,
// shared with hero-form so the two can never drift apart; this module owns only
// the section wrapper around it.
const { esc } = require('../lib/escape');
const { renderForm } = require('../lib/formfields');

module.exports = function contactForm(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';

  // The form spec sits at this block's root, so annotation paths need no
  // prefix and the historical 6-space body indent is the default.
  const form = renderForm(fields, bk, { className: 'contact-form' });

  return `<section class="contact-form-section">
  <div class="container">
    ${tag}
    ${heading}
    ${form}
  </div>
</section>`;
};
