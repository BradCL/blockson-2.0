'use strict';

const { esc } = require('../lib/escape');

module.exports = function pageHeader(fields, site, bk) {
  const bgClass   = fields.variant === 'light' ? 'page-header-bg about-page-bg' : 'page-header-bg';
  // Background falls back to the site hero image when omitted (see
  // BLOCK_CATALOG.md). site.heroImage is derived in build.js; the theme CSS
  // still carries a last-ditch banner.jpg for a site with no hero at all.
  const bg        = fields.background || (site && site.heroImage);
  const bgStyle   = bg
    ? ` style="background-image:url('${esc(bg)}')"` : '';
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
