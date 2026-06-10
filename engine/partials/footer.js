'use strict';

const { esc } = require('../lib/escape');

module.exports = function footer(site, bk) {
  const cols = (site.footer.columns || []).map(col => {
    const items = col.items.map(item =>
      item.href
        ? `<a href="${esc(item.href)}">${esc(item.label)}</a>`
        : `<p>${esc(item.label)}</p>`
    ).join('\n        ');
    return `<div class="footer-col">
      <h4>${esc(col.heading)}</h4>
      ${items}
    </div>`;
  }).join('\n    ');

  const tagline = site.tagline ? `<span${bk.f('tagline')}>${esc(site.tagline)}</span>` : '';

  return `<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="footer-logo">
          <img src="${esc(site.logo.white)}" alt="${esc(site.name)}">
        </div>
        <p${bk.f('footer.blurb')}>${esc(site.footer.blurb)}</p>
      </div>
      ${cols}
    </div>
    <div class="footer-bottom">
      <span${bk.f('copyright')}>${esc(site.copyright)}</span>
      ${tagline}
    </div>
  </div>
</footer>
<script src="js/main.js"></script>`;
};
