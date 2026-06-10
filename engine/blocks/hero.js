'use strict';

const { esc } = require('../lib/escape');

module.exports = function hero(fields, site, bk) {
  const actions = (fields.actions || []).map(a =>
    `<a href="${esc(a.href)}" class="btn btn-${esc(a.style)}">${esc(a.label)}</a>`
  ).join('\n          ');

  return `<section class="hero">
  <div class="hero-bg"${bk.f('background')} style="background-image:url('${esc(fields.background)}')"></div>
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
