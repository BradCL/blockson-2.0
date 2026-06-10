'use strict';

// team-grid — staff profiles: photo, name, role, short bio. Serves salons,
// vet clinics, fitness studios, daycares, realty teams. Photo optional —
// a missing photo renders a neutral initial block, never a broken image.
const { esc } = require('../lib/escape');

module.exports = function teamGrid(fields) {
  const tag     = fields.tag     ? `<div class="section-tag">${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2>${esc(fields.heading)}</h2>` : '';

  const members = (fields.members || []).map(m => {
    const photo = m.photo
      ? `<div class="team-photo"><img src="${esc(m.photo)}" alt="${esc(m.name)}" loading="lazy"></div>`
      : `<div class="team-photo team-photo-empty" aria-hidden="true"><span>${esc(String(m.name || '?').charAt(0))}</span></div>`;
    const bio = m.bio ? `<p class="team-bio">${esc(m.bio)}</p>` : '';
    return `<div class="team-card fade-in">
        ${photo}
        <h3>${esc(m.name)}</h3>
        <div class="team-role">${esc(m.role)}</div>
        ${bio}
      </div>`;
  }).join('\n      ');

  return `<section class="team">
  <div class="container">
    <div class="section-header">
      ${tag}
      ${heading}
    </div>
    <div class="team-grid">
      ${members}
    </div>
  </div>
</section>`;
};
