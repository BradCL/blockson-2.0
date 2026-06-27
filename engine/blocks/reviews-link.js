'use strict';

// reviews-link — a styled, CAPTURE-FREE outbound badge that links to a
// business's external reviews/profile page (Google today; Facebook/etc.
// later). It is NOT an embed, NOT a third-party widget, NOT the Places API:
// no API key, no JavaScript, no network call, no data capture. The rating and
// review count are OWNER-MAINTAINED STATIC TEXT, not live-synced — the block's
// honesty rests on it being a real link to the real listing, never a scraped
// or faked rating. Platform-agnostic: nothing here hard-codes "Google".
//
// The whole badge is a single <a href>. A default label is composed from the
// present fields ("★ 5.0 · 11 reviews on Google →"), gracefully degrading as
// rating/reviewCount/platform are absent. An owner-supplied `label` overrides
// the composed text outright. Every editable field is annotated with bk.f(...)
// so the annotated build covers it.
const { esc } = require('../lib/escape');

function has(v) { return v != null && String(v).trim() !== ''; }

module.exports = function reviewsLink(fields, site, bk) {
  const tag     = has(fields.tag)
    ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = has(fields.heading)
    ? `<h2 class="reviews-link-heading"${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';

  // Inner badge text. A custom `label` replaces the whole composition;
  // otherwise compose from whichever of rating / reviewCount / platform exist.
  let inner;
  if (has(fields.label)) {
    inner = `<span class="reviews-link-label"${bk.f('label')}>${esc(fields.label)}</span>`;
  } else {
    const rating = has(fields.rating)
      ? `<span class="reviews-link-star" aria-hidden="true">★</span> <span class="reviews-link-rating"${bk.f('rating')}>${esc(fields.rating)}</span>`
      : '';
    const count = has(fields.reviewCount)
      ? `<span class="reviews-link-count"${bk.f('reviewCount')}>${esc(fields.reviewCount)}</span> reviews`
      : '';
    const platform = has(fields.platform)
      ? `<span class="reviews-link-platform"${bk.f('platform')}>${esc(fields.platform)}</span>`
      : '';

    const lead = [rating, count].filter(Boolean).join(' · ');
    if (lead && platform)      inner = `${lead} on ${platform}`;
    else if (lead)             inner = lead;
    else if (platform)         inner = `Reviews on ${platform}`;
    else                       inner = 'Reviews';
  }

  return `<section class="reviews-link-section fade-in">
  <div class="container">
    ${tag}
    ${heading}
    <a class="reviews-link" href="${esc(fields.url)}" target="_blank" rel="noopener noreferrer"${bk.f('url')}>
      <span class="reviews-link-text">${inner}</span>
      <span class="reviews-link-arrow" aria-hidden="true">→</span>
    </a>
  </div>
</section>`;
};
