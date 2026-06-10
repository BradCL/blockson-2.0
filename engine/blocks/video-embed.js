'use strict';

// video-embed — a single responsive embedded video. The schema restricts
// videoUrl to YouTube/Vimeo EMBED endpoints (defense in depth alongside
// escaping): an arbitrary iframe src is an injection surface; a known
// embed host is not.
const { esc } = require('../lib/escape');

module.exports = function videoEmbed(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';
  const caption = fields.caption ? `<p class="video-caption">${esc(fields.caption)}</p>` : '';
  const title   = fields.caption || fields.heading || 'Embedded video';

  return `<section class="video-embed fade-in">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="video-frame">
      <iframe src="${esc(fields.videoUrl)}" title="${esc(title)}"
        loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen></iframe>
    </div>
    ${caption}
  </div>
</section>`;
};
