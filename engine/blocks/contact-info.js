'use strict';

const { esc }    = require('../lib/escape');
const { iconSvg } = require('../lib/icons');

module.exports = function contactInfo(fields) {
  const items = (fields.items || []).map(item => {
    const icon  = item.icon ? iconSvg(item.icon, 'contact-info-icon') : '';
    const inner = `
        ${icon}
        <span class="contact-info-label">${esc(item.label)}</span>
        <span class="contact-info-value">${esc(item.value)}</span>`;
    return item.href
      ? `<a href="${esc(item.href)}" class="contact-info-item">${inner}\n      </a>`
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
