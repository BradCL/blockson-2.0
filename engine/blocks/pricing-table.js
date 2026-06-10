'use strict';

// pricing-table — tiered plans OR item-based price lists (menus, service menus,
// membership tiers, rate cards). Plans render as cards; `featured` lifts one
// visually. No layout-affecting fields are exposed; all strings escaped.
const { esc } = require('../lib/escape');

module.exports = function pricingTable(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';
  const note    = fields.note    ? `<p class="pricing-note">${esc(fields.note)}</p>` : '';

  const plans = (fields.plans || []).map(plan => {
    const period   = plan.period ? `<span class="pricing-period">${esc(plan.period)}</span>` : '';
    const desc     = plan.description ? `<p class="pricing-desc">${esc(plan.description)}</p>` : '';
    const features = plan.features && plan.features.length
      ? `<ul class="pricing-features">${plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '';
    const cta = plan.cta
      ? `<a href="${esc(plan.cta.href)}" class="btn btn-${esc(plan.cta.style)}">${esc(plan.cta.label)}</a>`
      : '';
    return `<div class="pricing-card${plan.featured ? ' featured' : ''} fade-in">
        <h3>${esc(plan.name)}</h3>
        <div class="pricing-price">${esc(plan.price)}${period}</div>
        ${desc}
        ${features}
        ${cta}
      </div>`;
  }).join('\n      ');

  return `<section class="pricing">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="pricing-grid">
      ${plans}
    </div>
    ${note}
  </div>
</section>`;
};
