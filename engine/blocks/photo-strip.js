'use strict';

// photo-strip — a full-bleed band of finished-work photos: no titles, no
// filter, no lightbox. The home-page companion to the `gallery` block
// (gallery = a browsable, filterable album grid on its own page; photo-strip
// = a flat, edge-to-edge banner of images, typically dropped under a services
// overview). Each photo is replaceable through the click-to-edit image picker
// and can OPTIONALLY carry a link, turning the strip into a doorway into the
// gallery. A link-less photo's alt text is derived from the site name — the
// same convention gallery/team-grid/before-after use — so a captionless,
// link-less photo never carries a second, unreachable edit target, and its
// maintenance surface is exactly "swap this picture".
const { esc, escAttr } = require('../lib/escape');

module.exports = function photoStrip(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const header  = (tag || heading)
    ? `<div class="container photo-strip-head">${tag}${heading}</div>`
    : '';

  // Column count. Absent → the CSS default (4 across), byte-identical to the
  // pre-feature build: nothing is emitted at all. Set → one custom property the
  // stylesheet's `repeat(var(--photo-strip-cols, 4), 1fr)` reads, so a strip of
  // 3 or 5 photos fills its row instead of leaving a hole.
  //
  // The property rides the SECTION and is inherited by the grid, rather than
  // being declared on the grid itself. That is load-bearing: an inline
  // declaration outranks every stylesheet rule, so a value set on the grid
  // would freeze the count at all widths and the responsive steps could never
  // fire. Inherited, it is the value the media queries override.
  const cols      = fields.columns;
  const colsAttrs = cols ? ` data-cols="${escAttr(String(cols))}" style="--photo-strip-cols:${Number(cols)}"` : '';

  // A photo with a `link` becomes a doorway (typically into the gallery page):
  // the whole cell is an anchor and the cue names where it goes. Three
  // click-to-edit targets live on it without overlapping — the image rides the
  // inner wrapper (click the photo to swap it), the cue label rides its own
  // span (click the words to edit them), and the link URL rides the anchor
  // (reached by clicking the cue's arrow); the overlay resolves to the
  // innermost annotated element. `linkLabel` falls back to a default when
  // unset, and bk.i self-gates so it's only an edit target once the field
  // exists. A photo with no link renders exactly as before: a plain decorative
  // cell whose image is the only edit target.
  //
  // ACCESSIBLE NAME. A linked cell's name is the cue text and nothing else:
  //   - the photo is decorative INSIDE the link (alt=""), because repeating the
  //     site name on every linked cell made four doorways announce identically
  //     with no hint of where any of them went;
  //   - the cue is exposed to assistive tech (it was the one part hidden from
  //     it), so the owner-editable `linkLabel` — "View gallery", "Deck photos"
  //     — IS the link's name, in the tree and on screen alike;
  //   - only the arrow glyph stays aria-hidden: it is pure decoration, and
  //     leaving it in the name appended a stray "→" to every announcement.
  // The hover zoom is unchanged; the cue's fade is now hover-only (see the
  // stylesheet), so touch users — who have no hover and previously saw no
  // label at all — get a permanently visible one.
  const cells = (fields.photos || []).map(p => {
    if (p.link) {
      const cueText = p.linkLabel != null ? p.linkLabel : 'View gallery';
      return `<a class="photo-strip-cell photo-strip-cell--link" href="${escAttr(p.link)}"${bk.i(p.id, 'link')}>
        <span class="photo-strip-img"${bk.i(p.id, 'image')}><img src="${esc(p.image)}" alt="" loading="lazy"></span>
        <span class="photo-strip-cue"><span class="photo-strip-cue-text"${bk.i(p.id, 'linkLabel')}>${esc(cueText)}</span><span class="photo-strip-cue-arrow" aria-hidden="true"> →</span></span>
      </a>`;
    }
    return `<div class="photo-strip-cell"${bk.i(p.id, 'image')}>
        <img src="${esc(p.image)}" alt="${esc(site.name || '')}" loading="lazy">
      </div>`;
  }).join('\n      ');

  return `<section class="photo-strip"${colsAttrs}>
  ${header}
  <div class="photo-strip-grid"${bk.f('columns')}>
      ${cells}
  </div>
</section>`;
};
