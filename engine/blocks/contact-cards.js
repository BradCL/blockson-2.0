'use strict';

const { esc }    = require('../lib/escape');
const { iconSvg } = require('../lib/icons');

module.exports = function contactCards(fields, site, bk) {
  const cards = (fields.cards || []).map(card => {
    const icon  = card.icon ? iconSvg(card.icon, 'contact-card-icon', bk.i(card.id, 'icon')) : '';
    const body  = card.body ? `<p${bk.i(card.id, 'body')}>${esc(card.body)}</p>` : '';
    const list  = card.items && card.items.length
      ? `<ul class="contact-card-list"${bk.i(card.id, 'items')}>${card.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
      : '';
    const note  = card.note ? `<p class="contact-card-note"${bk.i(card.id, 'note')}>${esc(card.note)}</p>` : '';
    const cta   = `<a href="${esc(card.cta.href)}" class="btn btn-${esc(card.cta.style)}"${bk.i(card.id, 'cta')}>${esc(card.cta.label)}</a>`;
    return `<div class="contact-card fade-in">
        ${icon}
        <h2${bk.i(card.id, 'title')}>${esc(card.title)}</h2>
        ${body}
        ${list}
        ${note}
        ${cta}
      </div>`;
  }).join('\n      ');

  return `<section class="contact-paths">
  <div class="container">
    <div class="contact-path-grid">
      ${cards}
    </div>
  </div>
</section>`;
};
