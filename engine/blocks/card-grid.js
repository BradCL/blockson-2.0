'use strict';

const { esc }    = require('../lib/escape');
const { iconSvg } = require('../lib/icons');

module.exports = function cardGrid(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const cols    = fields.columns || 3;

  const gridStyle = cols === 2
    ? ' style="grid-template-columns:repeat(2,1fr)"' : '';

  const cards = (fields.cards || []).map(card => {
    const icon = card.icon ? iconSvg(card.icon, 'card-icon', bk.i(card.id, 'icon')) : '';
    const body = card.body ? `<p${bk.i(card.id, 'body')}>${esc(card.body)}</p>` : '';
    const list = card.items && card.items.length
      ? `<ul class="service-card-list"${bk.i(card.id, 'items')}>${card.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
      : '';
    return `<div class="service-card fade-in">
        ${icon}
        <h3${bk.i(card.id, 'title')}>${esc(card.title)}</h3>
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
    <div class="services-grid"${bk.f('columns')}${gridStyle}>
      ${cards}
    </div>
  </div>
</section>`;
};
