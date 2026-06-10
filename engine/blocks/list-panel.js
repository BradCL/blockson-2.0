'use strict';

const { esc } = require('../lib/escape');

module.exports = function listPanel(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';
  const items   = (fields.items || []).map(i => `<li>${esc(i)}</li>`).join('\n          ');

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
