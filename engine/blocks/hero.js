'use strict';

const { esc } = require('../lib/escape');

module.exports = function hero(fields, site, bk) {
  // Each button is an addressable item once its action carries an id (seeded
  // by extras/add-action-ids.js). The annotation rides field=label only — the
  // single clickable element for the whole button; href/style share this <a>
  // and are edited through the button editor that opens from the click. bk.i
  // is gated against the edit map, so an un-migrated (id-less) action gets no
  // annotation, and a live build's NOOP annotator emits nothing at all.
  const actions = (fields.actions || []).map(a =>
    `<a href="${esc(a.href)}" class="btn btn-${esc(a.style)}"${bk.i(a.id, 'label')}>${esc(a.label)}</a>`
  ).join('\n          ');

  // Owner-editable focal point + zoom (optional; absent → today's painting:
  // background-position:center, no scale). The values that reach here have
  // already cleared the patch.js format guard, but esc() is kept as the
  // last line of defence so nothing untrusted lands raw in an inline style.
  // Zoom is a transform:scale on .hero-bg, which keeps the CSS's
  // background-size:cover semantics intact at zoom 1; .hero-bg's negative
  // z-index keeps it behind the content even with a transform applied.
  const bgPosition = typeof fields.bgPosition === 'string' && fields.bgPosition ? fields.bgPosition : '50% 50%';
  const bgZoom = typeof fields.bgZoom === 'number' ? fields.bgZoom : 1;
  const bgStyle = `background-image:url('${esc(fields.background)}')`
    + `;background-position:${esc(bgPosition)}`
    + `;transform:scale(${esc(String(bgZoom))});transform-origin:${esc(bgPosition)}`;

  return `<section class="hero">
  <div class="hero-bg"${bk.bg('background')} style="${bgStyle}"></div>
  <div class="container">
    <div class="hero-content">
      <div class="hero-tag"${bk.f('tag')}>${esc(fields.tag)}</div>
      <h1${bk.f('headline')}>${esc(fields.headline)}</h1>
      <p${bk.f('subhead')}>${esc(fields.subhead)}</p>
      ${actions ? `<div class="hero-actions">${actions}</div>` : ''}
    </div>
  </div>
</section>`;
};
