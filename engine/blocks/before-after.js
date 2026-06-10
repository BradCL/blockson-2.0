'use strict';

// before-after — paired image comparison (renovation, salon, landscaping,
// detailing). Static side-by-side pairs with Before/After labels — chosen
// over a JS slider so the block has zero runtime dependencies.
const { esc } = require('../lib/escape');

module.exports = function beforeAfter(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';

  const pairs = (fields.pairs || []).map(p => {
    const title   = p.title ? esc(p.title) : '';
    const caption = (p.title || p.caption)
      ? `<figcaption>${title}${p.title && p.caption ? ' — ' : ''}${p.caption ? esc(p.caption) : ''}</figcaption>`
      : '';
    return `<figure class="ba-pair fade-in">
        <div class="ba-images">
          <div class="ba-side">
            <img src="${esc(p.before)}" alt="Before${p.title ? ' — ' + esc(p.title) : ''}" loading="lazy">
            <span class="ba-label">Before</span>
          </div>
          <div class="ba-side">
            <img src="${esc(p.after)}" alt="After${p.title ? ' — ' + esc(p.title) : ''}" loading="lazy">
            <span class="ba-label ba-label-after">After</span>
          </div>
        </div>
        ${caption}
      </figure>`;
  }).join('\n      ');

  return `<section class="before-after">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="ba-grid">
      ${pairs}
    </div>
  </div>
</section>`;
};
