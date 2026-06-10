'use strict';

const { esc } = require('../lib/escape');

module.exports = function pageHeader(fields) {
  const bgClass   = fields.variant === 'light' ? 'page-header-bg about-page-bg' : 'page-header-bg';
  const bgStyle   = fields.background
    ? ` style="background-image:url('${esc(fields.background)}')"` : '';
  const subhead   = fields.subhead
    ? `<p>${esc(fields.subhead)}</p>` : '';

  return `<header class="page-header">
  <div class="${bgClass}"${bgStyle}></div>
  <div class="container">
    <div class="page-header-content">
      <div class="section-tag">${esc(fields.tag)}</div>
      <h1>${esc(fields.heading)}</h1>
      ${subhead}
    </div>
  </div>
</header>`;
};
