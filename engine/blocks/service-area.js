'use strict';

const { esc } = require('../lib/escape');

module.exports = function serviceArea(fields) {
  const body  = fields.body ? `<p class="area-desc">${esc(fields.body)}</p>` : '';
  const items = (fields.areas || []).map(a => `<li>${esc(a)}</li>`).join('\n          ');

  const mapCol = fields.mapEmbedUrl
    ? `<div class="area-map">
        <iframe src="${esc(fields.mapEmbedUrl)}" loading="lazy"
          title="Service area map" allowfullscreen></iframe>
      </div>`
    : '';

  const innerCols = fields.mapEmbedUrl
    ? ''
    : ' style="grid-template-columns:1fr"';

  return `<section class="service-area fade-in">
  <div class="container">
    <div class="service-area-inner"${innerCols}>
      <div>
        <h2>${esc(fields.heading)}</h2>
        ${body}
        <ul class="area-list">
          ${items}
        </ul>
      </div>
      ${mapCol}
    </div>
  </div>
</section>`;
};
