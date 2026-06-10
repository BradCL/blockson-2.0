'use strict';

const { esc } = require('../lib/escape');

module.exports = function cta(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag centered"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const subtext = fields.subtext ? `<p class="closing-sub"${bk.f('subtext')}>${esc(fields.subtext)}</p>` : '';

  return `<section class="closing fade-in">
  <div class="container">
    ${tag}
    <p class="closing-statement"${bk.f('statement')}>${esc(fields.statement)}</p>
    ${subtext}
    <a href="${esc(fields.button.href)}" class="btn btn-${esc(fields.button.style)}"${bk.f('button.label')}>${esc(fields.button.label)}</a>
  </div>
</section>`;
};
