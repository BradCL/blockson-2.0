'use strict';

const { esc } = require('../lib/escape');

module.exports = function footer(site, bk) {
  // `footer.columns` has always been an unbounded array while the CSS was
  // `2fr 1fr 1fr 1fr` — brand plus exactly three. A fourth column (Services
  // alongside Pages / Contact / Service Area) wrapped into a lopsided row, so
  // the schema and the layout disagreed about how many columns are supported.
  // The count now rides a custom property the stylesheet's
  // `2fr repeat(var(--footer-cols, 3), 1fr)` reads, and it is emitted ONLY when
  // it differs from three — so the overwhelmingly common three-column footer
  // stays byte-identical to the pre-feature output. The property sits on the
  // grid; the responsive rules below 900px override grid-template-columns
  // itself, which outranks a custom property the base rule merely reads.
  const columns  = site.footer.columns || [];
  const colStyle = columns.length !== 3 ? ` style="--footer-cols:${columns.length}"` : '';

  const cols = columns.map(col => {
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
    <div class="footer-grid"${colStyle}>
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
