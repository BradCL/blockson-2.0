'use strict';

const { esc } = require('../lib/escape');

module.exports = function nav(site, currentSlug) {
  const links = (site.nav.links || []).map(link => {
    const href   = esc(link.href);
    const label  = esc(link.label);
    const slug   = link.href.replace(/\.html$/, '').replace(/^\//, '');
    const active = (slug === currentSlug || (currentSlug === 'index' && (slug === '' || slug === 'index')))
      ? ' class="active"' : '';
    return `<a href="${href}"${active}>${label}</a>`;
  }).join('\n        ');

  const cta = site.nav.cta
    ? `<a href="${esc(site.nav.cta.href)}" class="nav-cta">${esc(site.nav.cta.label)}</a>`
    : '';

  return `<nav class="nav">
  <div class="container">
    <a href="index.html" class="nav-logo">
      <img src="${esc(site.logo.white)}" alt="${esc(site.name)}">
    </a>
    <div class="nav-links">
      ${links}
      ${cta}
    </div>
    <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>`;
};
