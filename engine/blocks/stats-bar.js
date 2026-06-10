'use strict';

// stats-bar — 3–4 large numbers with labels ("14 years in business",
// "2,400 jobs completed"). Values are plain strings so owners can write
// "2,400+" or "98%" — the engine never does math on them.
const { esc } = require('../lib/escape');

module.exports = function statsBar(fields, site, bk) {
  const stats = (fields.stats || []).map(s =>
    `<div class="stat fade-in">
        <div class="stat-value"${bk.i(s.id, 'value')}>${esc(s.value)}</div>
        <div class="stat-label"${bk.i(s.id, 'label')}>${esc(s.label)}</div>
      </div>`
  ).join('\n      ');

  return `<section class="stats-bar">
  <div class="container">
    <div class="stats-grid">
      ${stats}
    </div>
  </div>
</section>`;
};
