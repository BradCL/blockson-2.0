'use strict';

// booking-cta — a prominent call-to-action that links OUT to a third-party
// booking system (Calendly, Jane, OpenTable, Fresha…). Distinct from `cta`:
// it opens in a new tab with rel="noopener" and can name the provider, so
// owners understand the click leaves their site.
const { esc } = require('../lib/escape');

module.exports = function bookingCta(fields) {
  const tag      = fields.tag      ? `<div class="section-tag centered">${esc(fields.tag)}</div>` : '';
  const subtext  = fields.subtext  ? `<p class="closing-sub">${esc(fields.subtext)}</p>` : '';
  const provider = fields.provider ? `<p class="booking-provider">Online booking via ${esc(fields.provider)}</p>` : '';
  const note     = fields.note     ? `<p class="booking-note">${esc(fields.note)}</p>` : '';

  return `<section class="booking-cta fade-in">
  <div class="container">
    ${tag}
    <p class="closing-statement">${esc(fields.statement)}</p>
    ${subtext}
    <a href="${esc(fields.button.href)}" class="btn btn-primary" target="_blank" rel="noopener">${esc(fields.button.label)}</a>
    ${provider}
    ${note}
  </div>
</section>`;
};
