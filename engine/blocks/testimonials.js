'use strict';

// testimonials — quote cards with a star row. A quote OPTIONALLY carries a
// `link`, which is what turns a wall of claims into a wall of CHECKABLE claims:
// each card can point at the review it was copied from, on the listing it lives
// on. That is the same honesty the reviews-link block is built around — a
// rating is only worth what the reader can go and verify — applied one card at
// a time. A link-less quote renders byte-identically to the pre-feature output;
// the link surface is purely additive.
const { esc, escAttr } = require('../lib/escape');

module.exports = function testimonials(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';

  const cards = (fields.quotes || []).map(q => {
    const stars = '★'.repeat(q.stars || 5);

    // The link is a real, always-visible anchor at the foot of the card — the
    // card-grid `cue` shape — never a hit area stretched over the card. Both
    // reasons carry over verbatim: a card-sized anchor would take its
    // accessible name from the whole quote, and a stretched ::after belongs to
    // the anchor, so in the annotated preview every click on the card would
    // resolve to the link and the quote/attribution/stars editors would become
    // unreachable.
    //
    // ACCESSIBLE NAME. Six review cards pointing at one listing is the exact
    // shape that produced the photo-strip defect — four doorways announcing
    // identically. So the name is the visible cue text plus a
    // screen-reader-only "· <attribution>" suffix, giving "Read the review ·
    // Kreesta M.", "Read the review · Dana M.", … The attribution is
    // schema-required, so the distinguishing half is always there, and the
    // visible label stays a prefix of the accessible name (WCAG 2.5.3).
    // A per-card possessive ("Read Kreesta M's review") was the other candidate
    // and is not used: the possessive can't be formed reliably from arbitrary
    // attribution text ("Dana M. & Sons", "Chris"), and naming the platform is
    // not this block's to do — it holds no `platform` field, and an owner who
    // wants that wording sets `linkLabel` to it per card.
    //
    // Opens in a new tab: the destination is somebody else's listing, so the
    // site stays put — the same call gallery's album link and reviews-link
    // already make for outbound targets.
    //
    // `linkLabel` falls back to a default when unset, and bk.i self-gates, so
    // it only becomes an edit target once the field exists. The URL rides the
    // anchor (click the arrow to repoint it), the wording rides its own span.
    const cue = q.link
      ? `\n        <a class="testimonial-cue" href="${escAttr(q.link)}" target="_blank" rel="noopener noreferrer"${bk.i(q.id, 'link')}><span${bk.i(q.id, 'linkLabel')}>${esc(q.linkLabel != null ? q.linkLabel : 'Read the review')}</span><span class="sr-only"> · ${esc(q.attribution)}</span><span class="testimonial-cue-arrow" aria-hidden="true"> →</span></a>`
      : '';

    return `<div class="testimonial-card${q.link ? ' testimonial-card--link' : ''} fade-in">
        <div class="stars"${bk.i(q.id, 'stars')}>${stars}</div>
        <blockquote${bk.i(q.id, 'quote')}>${esc(q.quote)}</blockquote>
        <div class="attribution"${bk.i(q.id, 'attribution')}>${esc(q.attribution)}</div>${cue}
      </div>`;
  }).join('\n      ');

  return `<section class="testimonials">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="testimonials-grid">
      ${cards}
    </div>
  </div>
</section>`;
};
