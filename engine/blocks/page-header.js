'use strict';

const { esc } = require('../lib/escape');

module.exports = function pageHeader(fields, site, bk) {
  const bgClass   = fields.variant === 'light' ? 'page-header-bg about-page-bg' : 'page-header-bg';
  const bgStyle   = fields.background
    ? ` style="background-image:url('${esc(fields.background)}')"` : '';
  const subhead   = fields.subhead
    ? `<p${bk.f('subhead')}>${esc(fields.subhead)}</p>` : '';

  return `<header class="page-header"${bk.f('variant')}>
  <div class="${bgClass}"${bk.f('background')}${bgStyle}></div>
  <div class="container">
    <div class="page-header-content">
      <div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>
      <h1${bk.f('heading')}>${esc(fields.heading)}</h1>
      ${subhead}
    </div>
  </div>
</header>`;
};
