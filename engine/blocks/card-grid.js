'use strict';

// card-grid — the most reusable block: services, features, values. A card
// OPTIONALLY carries a `link`, which is what turns a services overview into a
// directory: one card per service, each pointing at that service's own page
// (the shape local SEO wants). A link-less card renders byte-identically to
// the pre-feature output — the link surface is purely additive.
const { esc, escAttr } = require('../lib/escape');
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

    // The link is a REAL, always-visible anchor at the foot of the card — the
    // contact-cards `cta` shape — not a hit area stretched over the whole card.
    // Two reasons, both load-bearing:
    //   - Accessible name. A card-sized anchor takes its name from everything
    //     inside it, so a service card announces as its title + body + sub-list
    //     in one breath. Here the name is short and unique: the visible cue text
    //     plus a screen-reader-only "· <title>" suffix, so four cards read
    //     "Learn more · Basement Development", "Learn more · Hardscaping", …
    //     rather than four identical "Learn more"s. The visible label is a
    //     prefix of the accessible name, which is what WCAG 2.5.3 asks for.
    //   - Click-to-edit. A stretched ::after belongs to the anchor, so in the
    //     annotated preview EVERY click on the card would resolve to the link
    //     field and the title/body/list editors would become unreachable. A
    //     discrete anchor keeps each edit target exactly where it renders.
    // `linkLabel` falls back to a default when unset, and bk.i self-gates, so
    // it only becomes an edit target once the field exists.
    const cue = card.link
      ? `\n        <a class="service-card-cue" href="${escAttr(card.link)}"${bk.i(card.id, 'link')}><span${bk.i(card.id, 'linkLabel')}>${esc(card.linkLabel != null ? card.linkLabel : 'Learn more')}</span><span class="sr-only"> · ${esc(card.title)}</span><span class="service-card-cue-arrow" aria-hidden="true"> →</span></a>`
      : '';

    return `<div class="service-card${card.link ? ' service-card--link' : ''} fade-in">
        ${icon}
        <h3${bk.i(card.id, 'title')}>${esc(card.title)}</h3>
        ${body}
        ${list}${cue}
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
