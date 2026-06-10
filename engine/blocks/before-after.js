'use strict';

// before-after — paired image comparison (renovation, salon, landscaping,
// detailing). Static side-by-side pairs with Before/After labels — chosen
// over a JS slider so the block has zero runtime dependencies.
const { esc } = require('../lib/escape');

module.exports = function beforeAfter(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';

  const pairs = (fields.pairs || []).map(p => {
    const title   = p.title ? esc(p.title) : '';
    // The figcaption mixes title and caption text; to give each its own
    // annotation carrier, `title` rides the outer <figure> and `caption`
    // rides the <figcaption> (the before/after image paths ride the two
    // .ba-side wrappers).
    const caption = (p.title || p.caption)
      ? `<figcaption${bk.i(p.id, 'caption')}>${title}${p.title && p.caption ? ' — ' : ''}${p.caption ? esc(p.caption) : ''}</figcaption>`
      : '';
    return `<figure class="ba-pair fade-in"${bk.i(p.id, 'title')}>
        <div class="ba-images">
          <div class="ba-side"${bk.i(p.id, 'before')}>
            <img src="${esc(p.before)}" alt="Before${p.title ? ' — ' + esc(p.title) : ''}" loading="lazy">
            <span class="ba-label">Before</span>
          </div>
          <div class="ba-side"${bk.i(p.id, 'after')}>
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
