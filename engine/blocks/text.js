'use strict';

const { esc } = require('../lib/escape');

module.exports = function text(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const paras   = (fields.body || []).map((p, i) => `<p${bk.l('body', i)}>${esc(p)}</p>`).join('\n      ');

  return `<section class="about-intro fade-in">
  <div class="container">
    <div class="about-intro-body">
      ${tag}
      ${heading}
      ${paras}
    </div>
  </div>
</section>`;
};
