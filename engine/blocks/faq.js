'use strict';

// faq — expandable question/answer pairs using native <details>/<summary>,
// so the accordion needs ZERO JavaScript and stays accessible by default.
// (Chosen over a JS accordion deliberately: no runtime dependency to break.)
const { esc } = require('../lib/escape');

module.exports = function faq(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';

  const items = (fields.items || []).map(item =>
    `<details class="faq-item fade-in">
        <summary>${esc(item.question)}</summary>
        <p>${esc(item.answer)}</p>
      </details>`
  ).join('\n      ');

  return `<section class="faq">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="faq-list">
      ${items}
    </div>
  </div>
</section>`;
};
