'use strict';

const { esc, escAttr } = require('../lib/escape');

module.exports = function gallery(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';

  const filterBtns = (fields.filters || []).map((f, i) =>
    `<button class="filter-btn${i === 0 ? ' active' : ''}" data-filter="${escAttr(f.value)}">${esc(f.label)}</button>`
  ).join('\n      ');

  const albums = (fields.albums || []).map(album => {
    const thumb  = album.images[0];
    const imgs   = album.images.map(i => escAttr(i)).join(',');
    const meta   = album.meta ? `<span class="album-meta"${bk.i(album.id, 'meta')}>${esc(album.meta)}</span>` : '';
    // An optional external link turns the album into a doorway to the full set
    // (a hosted Google/Facebook album, say): the local images stay an on-site
    // lightbox teaser, and this link leads to everything. Opens in a new tab so
    // the site stays put; main.js stops its click from also tripping the
    // lightbox. The URL and the label are independent click-to-edit targets —
    // the href rides the anchor (clicking the arrow edits where it goes), the
    // optional linkLabel rides its own span (clicking the words edits them); an
    // owner can repoint the link if the host changes. `linkLabel` falls back to
    // a default when unset, and bk.i self-gates so it's only an edit target once
    // the field exists. Without an href the card behaves exactly as before.
    const linkText = album.linkLabel != null ? album.linkLabel : 'See all photos';
    const link   = album.href
      ? `<a class="album-link" href="${escAttr(album.href)}" target="_blank" rel="noopener"${bk.i(album.id, 'href')}><span class="album-link-text"${bk.i(album.id, 'linkLabel')}>${esc(linkText)}</span> <span class="album-link-arrow" aria-hidden="true">→</span></a>`
      : '';
    return `<div class="album-card fade-in"
        data-type="${escAttr(album.category)}"
        data-images="${imgs}"
        data-title="${escAttr(album.title)}"
        tabindex="0" role="button" aria-label="View ${escAttr(album.title)} gallery">
        <div class="album-card-img"${bk.i(album.id, 'images')}>
          <img src="${esc(thumb)}" alt="${esc(album.title)}" loading="lazy">
        </div>
        <div class="album-card-body">
          <span class="album-tag"${bk.i(album.id, 'category')}>${esc(album.category)}</span>
          <h3${bk.i(album.id, 'title')}>${esc(album.title)}</h3>
          ${meta}
          ${link}
        </div>
      </div>`;
  }).join('\n      ');

  return `<section class="gallery">
  <div class="container">
    ${tag}
    ${heading}
    <div class="filter-bar">
      ${filterBtns}
    </div>
    <div class="album-grid">
      ${albums}
    </div>
    <div class="gallery-empty" id="gallery-empty" hidden>No projects match this filter.</div>
  </div>
</section>`;
};
