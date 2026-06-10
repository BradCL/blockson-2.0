'use strict';

const { esc } = require('../lib/escape');

module.exports = function testimonials(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';

  const cards = (fields.quotes || []).map(q => {
    const stars = '★'.repeat(q.stars || 5);
    return `<div class="testimonial-card fade-in">
        <div class="stars"${bk.i(q.id, 'stars')}>${stars}</div>
        <blockquote${bk.i(q.id, 'quote')}>${esc(q.quote)}</blockquote>
        <div class="attribution"${bk.i(q.id, 'attribution')}>${esc(q.attribution)}</div>
      </div>`;
  }).join('\n      ');

  return `<section class="testimonials">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="testimonials-grid">
      ${cards}
    </div>
  </div>
</section>`;
};
