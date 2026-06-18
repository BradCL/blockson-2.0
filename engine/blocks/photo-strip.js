'use strict';

// photo-strip — a full-bleed band of finished-work photos: no titles, no
// filter, no lightbox. The home-page companion to the `gallery` block
// (gallery = a browsable, filterable album grid on its own page; photo-strip
// = a flat, edge-to-edge banner of images, typically dropped under a services
// overview). Each photo is replaceable through the click-to-edit image picker;
// alt text is derived from the site name — the same convention gallery/
// team-grid/before-after use — so a captionless photo never carries a second,
// unreachable edit target, and the maintenance surface is exactly "swap this
// picture".
const { esc } = require('../lib/escape');

module.exports = function photoStrip(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const header  = (tag || heading)
    ? `<div class="container photo-strip-head">${tag}${heading}</div>`
    : '';

  // The image path rides the cell wrapper (the <img> fills it, so a hover/
  // click anywhere on the photo resolves to the cell): its value is a path, so
  // the overlay opens the file picker.
  const cells = (fields.photos || []).map(p =>
    `<div class="photo-strip-cell"${bk.i(p.id, 'image')}>
        <img src="${esc(p.image)}" alt="${esc(site.name || '')}" loading="lazy">
      </div>`
  ).join('\n      ');

  return `<section class="photo-strip">
  ${header}
  <div class="photo-strip-grid">
      ${cells}
  </div>
</section>`;
};
