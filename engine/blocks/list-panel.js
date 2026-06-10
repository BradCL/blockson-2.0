'use strict';

const { esc } = require('../lib/escape');

module.exports = function listPanel(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const items   = (fields.items || []).map((i, idx) => `<li${bk.l('items', idx)}>${esc(i)}</li>`).join('\n          ');

  return `<section class="mission-pillars fade-in">
  <div class="container">
    ${tag}
    ${heading}
    <div class="mission-card">
      <ul class="mission-list">
        ${items}
      </ul>
    </div>
  </div>
</section>`;
};
