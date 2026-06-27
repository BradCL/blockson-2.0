'use strict';

// photo-strip — a full-bleed band of finished-work photos: no titles, no
// filter, no lightbox. The home-page companion to the `gallery` block
// (gallery = a browsable, filterable album grid on its own page; photo-strip
// = a flat, edge-to-edge banner of images, typically dropped under a services
// overview). Each photo is replaceable through the click-to-edit image picker
// and can OPTIONALLY carry a link, turning the strip into a doorway into the
// gallery; alt text is derived from the site name — the same convention
// gallery/team-grid/before-after use — so a captionless, link-less photo never
// carries a second, unreachable edit target, and its maintenance surface is
// exactly "swap this picture".
const { esc, escAttr } = require('../lib/escape');

module.exports = function photoStrip(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const header  = (tag || heading)
    ? `<div class="container photo-strip-head">${tag}${heading}</div>`
    : '';

  // A photo with a `link` becomes a doorway (typically into the gallery page):
  // the whole cell is an anchor and a cue fades in on hover to say "there's more
  // to see". Two click-to-edit targets live on it without overlapping — the
  // image rides the inner wrapper (click the photo to swap it) and the link
  // rides the anchor, reached by clicking the cue (the overlay resolves to the
  // innermost annotated element). A photo with no link renders exactly as
  // before: a plain decorative cell whose image is the only edit target.
  const cells = (fields.photos || []).map(p => {
    const img = `<img src="${esc(p.image)}" alt="${esc(site.name || '')}" loading="lazy">`;
    if (p.link) {
      return `<a class="photo-strip-cell photo-strip-cell--link" href="${escAttr(p.link)}"${bk.i(p.id, 'link')}>
        <span class="photo-strip-img"${bk.i(p.id, 'image')}>${img}</span>
        <span class="photo-strip-cue" aria-hidden="true">View gallery →</span>
      </a>`;
    }
    return `<div class="photo-strip-cell"${bk.i(p.id, 'image')}>
        ${img}
      </div>`;
  }).join('\n      ');

  return `<section class="photo-strip">
  ${header}
  <div class="photo-strip-grid">
      ${cells}
  </div>
</section>`;
};
