'use strict';

// process-steps — numbered sequential steps ("how we work"). Numbers come
// from array order at render time (presentation, not addressing — steps are
// still addressed by id in patches, never by their number).
const { esc }    = require('../lib/escape');
const { iconSvg } = require('../lib/icons');

module.exports = function processSteps(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';

  const steps = (fields.steps || []).map((s, i) => {
    const icon = s.icon ? iconSvg(s.icon, 'step-icon') : '';
    return `<li class="process-step fade-in">
        <div class="step-num" aria-hidden="true">${i + 1}</div>
        ${icon}
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.body)}</p>
      </li>`;
  }).join('\n      ');

  return `<section class="process">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <ol class="process-steps">
      ${steps}
    </ol>
  </div>
</section>`;
};
