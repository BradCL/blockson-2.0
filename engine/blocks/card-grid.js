'use strict';

const { esc }    = require('../lib/escape');
const { iconSvg } = require('../lib/icons');

module.exports = function cardGrid(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';
  const cols    = fields.columns || 3;

  const gridStyle = cols === 2
    ? ' style="grid-template-columns:repeat(2,1fr)"' : '';

  const cards = (fields.cards || []).map(card => {
    const icon = card.icon ? iconSvg(card.icon, 'card-icon') : '';
    const body = card.body ? `<p>${esc(card.body)}</p>` : '';
    const list = card.items && card.items.length
      ? `<ul class="service-card-list">${card.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
      : '';
    return `<div class="service-card fade-in">
        ${icon}
        <h3>${esc(card.title)}</h3>
        ${body}
        ${list}
      </div>`;
  }).join('\n      ');

  return `<section class="services">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="services-grid"${gridStyle}>
      ${cards}
    </div>
  </div>
</section>`;
};
