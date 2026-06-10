'use strict';

const { esc } = require('../lib/escape');

module.exports = function hero(fields) {
  const actions = (fields.actions || []).map(a =>
    `<a href="${esc(a.href)}" class="btn btn-${esc(a.style)}">${esc(a.label)}</a>`
  ).join('\n          ');

  return `<section class="hero">
  <div class="hero-bg" style="background-image:url('${esc(fields.background)}')"></div>
  <div class="container">
    <div class="hero-content">
      <div class="hero-tag">${esc(fields.tag)}</div>
      <h1>${esc(fields.headline)}</h1>
      <p>${esc(fields.subhead)}</p>
      ${actions ? `<div class="hero-actions">${actions}</div>` : ''}
    </div>
  </div>
</section>`;
};
