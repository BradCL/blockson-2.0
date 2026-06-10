'use strict';

const { esc } = require('../lib/escape');

module.exports = function serviceArea(fields, site, bk) {
  const body  = fields.body ? `<p class="area-desc"${bk.f('body')}>${esc(fields.body)}</p>` : '';
  const items = (fields.areas || []).map((a, idx) => `<li${bk.l('areas', idx)}>${esc(a)}</li>`).join('\n          ');

  const mapCol = fields.mapEmbedUrl
    ? `<div class="area-map"${bk.f('mapEmbedUrl')}>
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
        <h2${bk.f('heading')}>${esc(fields.heading)}</h2>
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
