'use strict';

const { esc, escAttr } = require('../lib/escape');

module.exports = function gallery(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';

  const filterBtns = (fields.filters || []).map((f, i) =>
    `<button class="filter-btn${i === 0 ? ' active' : ''}" data-filter="${escAttr(f.value)}">${esc(f.label)}</button>`
  ).join('\n      ');

  const albums = (fields.albums || []).map(album => {
    const thumb  = album.images[0];
    const imgs   = album.images.map(i => escAttr(i)).join(',');
    const meta   = album.meta ? `<span class="album-meta">${esc(album.meta)}</span>` : '';
    return `<div class="album-card fade-in"
        data-type="${escAttr(album.category)}"
        data-images="${imgs}"
        data-title="${escAttr(album.title)}"
        tabindex="0" role="button" aria-label="View ${escAttr(album.title)} gallery">
        <div class="album-card-img">
          <img src="${esc(thumb)}" alt="${esc(album.title)}" loading="lazy">
        </div>
        <div class="album-card-body">
          <span class="album-tag">${esc(album.category)}</span>
          <h3>${esc(album.title)}</h3>
          ${meta}
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
