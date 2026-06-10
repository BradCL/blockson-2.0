'use strict';

// hours-table — a structured day/hours grid. Better than list-panel for
// businesses with per-day hours: each row carries a stable id, so the
// maintenance tier edits "Saturday" hours directly instead of text-matching.
const { esc } = require('../lib/escape');

module.exports = function hoursTable(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';
  const note    = fields.note    ? `<p class="hours-note">${esc(fields.note)}</p>` : '';

  const rows = (fields.rows || []).map(r =>
    `<tr><th scope="row">${esc(r.day)}</th><td>${esc(r.hours)}</td></tr>`
  ).join('\n          ');

  return `<section class="hours fade-in">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="hours-card">
      <table class="hours-table">
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${note}
    </div>
  </div>
</section>`;
};
