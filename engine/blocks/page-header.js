'use strict';

const { esc } = require('../lib/escape');

module.exports = function pageHeader(fields, site, bk) {
  const bgClass   = fields.variant === 'light' ? 'page-header-bg about-page-bg' : 'page-header-bg';
  // Background falls back to the site hero image when omitted (see
  // BLOCK_CATALOG.md). site.heroImage is derived in build.js; the theme CSS
  // still carries a last-ditch banner.jpg for a site with no hero at all.
  const bg        = fields.background || (site && site.heroImage);

  // Owner-editable focal point + zoom, the same shape the hero already carries
  // (engine/blocks/hero.js): a cover crop on a wide/short desktop viewport cuts
  // symmetrically from the top, so a header photo with its subject up high gets
  // beheaded — these let the crop anchor on the subject instead. Optional, and
  // gated so the default stays byte-identical: with neither field set we emit
  // exactly today's markup (background-image only, or nothing), leaving the
  // theme CSS's background-position:center in force. esc() is the last line of
  // defence after patch.js's per-field format guard. Zoom is a transform:scale
  // on .page-header-bg, which keeps background-size:cover intact at zoom 1;
  // that layer's negative z-index keeps it behind the content under a scale.
  const hasPosition = typeof fields.bgPosition === 'string' && fields.bgPosition;
  const hasZoom     = typeof fields.bgZoom === 'number';
  let bgStyle = '';
  if (bg || hasPosition || hasZoom) {
    const decls = [];
    if (bg) decls.push(`background-image:url('${esc(bg)}')`);
    if (hasPosition || hasZoom) {
      const bgPosition = hasPosition ? fields.bgPosition : '50% 50%';
      const bgZoom     = hasZoom ? fields.bgZoom : 1;
      decls.push(`background-position:${esc(bgPosition)}`);
      decls.push(`transform:scale(${esc(String(bgZoom))})`);
      decls.push(`transform-origin:${esc(bgPosition)}`);
    }
    bgStyle = ` style="${decls.join(';')}"`;
  }
  const subhead   = fields.subhead
    ? `<p${bk.f('subhead')}>${esc(fields.subhead)}</p>` : '';

  return `<header class="page-header"${bk.f('variant')}>
  <div class="${bgClass}"${bk.bg('background')}${bgStyle}></div>
  <div class="container">
    <div class="page-header-content">
      <div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>
      <h1${bk.f('heading')}>${esc(fields.heading)}</h1>
      ${subhead}
    </div>
  </div>
</header>`;
};
