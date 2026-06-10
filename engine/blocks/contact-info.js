'use strict';

const { esc }    = require('../lib/escape');
const { iconSvg } = require('../lib/icons');

module.exports = function contactInfo(fields, site, bk) {
  const items = (fields.items || []).map(item => {
    const icon  = item.icon ? iconSvg(item.icon, 'contact-info-icon', bk.i(item.id, 'icon')) : '';
    const inner = `
        ${icon}
        <span class="contact-info-label"${bk.i(item.id, 'label')}>${esc(item.label)}</span>
        <span class="contact-info-value"${bk.i(item.id, 'value')}>${esc(item.value)}</span>`;
    return item.href
      ? `<a href="${esc(item.href)}" class="contact-info-item"${bk.i(item.id, 'href')}>${inner}\n      </a>`
      : `<div class="contact-info-item">${inner}\n      </div>`;
  }).join('\n      ');

  return `<section class="contact-info-section">
  <div class="container">
    <div class="contact-info-bar">
      ${items}
    </div>
  </div>
</section>`;
};
