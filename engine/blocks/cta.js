'use strict';

const { esc } = require('../lib/escape');

module.exports = function cta(fields) {
  const tag     = fields.tag     ? `<div class="section-tag centered">${esc(fields.tag)}</div>` : '';
  const subtext = fields.subtext ? `<p class="closing-sub">${esc(fields.subtext)}</p>` : '';

  return `<section class="closing fade-in">
  <div class="container">
    ${tag}
    <p class="closing-statement">${esc(fields.statement)}</p>
    ${subtext}
    <a href="${esc(fields.button.href)}" class="btn btn-${esc(fields.button.style)}">${esc(fields.button.label)}</a>
  </div>
</section>`;
};
