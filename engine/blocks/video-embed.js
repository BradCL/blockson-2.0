'use strict';

// video-embed — a single responsive embedded video. The schema restricts
// videoUrl to YouTube/Vimeo EMBED endpoints, and it is worth being exact about
// what that buys, because this comment used to claim more: the SCHEME check
// (^https://) is the security boundary — in an iframe src, javascript: and data:
// are live hazards — and esc() puts the value in a quoted attribute it cannot
// break out of. Both apply to every embed field in the engine. The host
// allowlist on top is a TYPO-CATCHER: this field means "a YouTube or Vimeo
// embed", so a wrong URL becomes a build error instead of an empty frame on a
// client's live page. A field with a broader meaning (service-area.mapEmbedUrl:
// "a map") is scheme-only for the same reason, not a different policy — see
// SPEC.md §2 principle 5.
const { esc } = require('../lib/escape');

module.exports = function videoEmbed(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  const caption = fields.caption ? `<p class="video-caption"${bk.f('caption')}>${esc(fields.caption)}</p>` : '';
  const title   = fields.caption || fields.heading || 'Embedded video';

  return `<section class="video-embed fade-in">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="video-frame"${bk.f('videoUrl')}>
      <iframe src="${esc(fields.videoUrl)}" title="${esc(title)}"
        loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen></iframe>
    </div>
    ${caption}
  </div>
</section>`;
};
