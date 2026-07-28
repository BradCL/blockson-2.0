'use strict';

/* Global navigation, driven by site.nav.
 *
 * A nav link may OPTIONALLY carry `children` — one level of sub-links, no
 * deeper. This exists because sites outgrow a flat nav: a contractor with eight
 * local-SEO service pages otherwise reaches them only from the footer or a hub
 * page, while the nav is the one element on every page (sitewide internal
 * linking matters as much as usability there).
 *
 * Four decisions worth knowing before you change this:
 *
 * 1. THE PARENT STAYS A REAL LINK. It is not converted into a pure toggle. A
 *    hub page ("Services", listing all eight) is valuable in its own right, and
 *    on a device with no hover it is the ONLY way into the children — see (3).
 *    Losing that link would be a real cost, so it is never paid.
 *
 * 2. THE PARENT READS AS ACTIVE WHEN A CHILD IS THE CURRENT PAGE. Exact-slug
 *    matching alone left a parent with eight children looking inactive on
 *    nearly every page of the site.
 *
 * 3. DISCLOSURE IS CSS, NOT JAVASCRIPT — :hover plus :focus-within, in the
 *    spirit of the faq block's zero-JS <details>. :focus-within is what makes
 *    it work for keyboard and screen-reader users: focusing the parent link
 *    reveals the children, so the next Tab reaches them. The hover half is
 *    gated behind `@media (hover: hover)` so sticky-hover on a touch screen
 *    cannot pin a menu open over the page. On a touch device wide enough to
 *    show the horizontal bar, the parent link simply navigates to its hub —
 *    which is why (1) is not negotiable. Below the collapse breakpoint the
 *    children render as a plain indented list inside the overlay, always
 *    visible: nothing to trap, nothing to discover. main.js adds Escape as a
 *    progressive enhancement; without JS the menu still works.
 *
 * 4. A LINK WITH NO CHILDREN RENDERS EXACTLY AS BEFORE — a bare <a>, no
 *    wrapper, no caret. The submenu surface is purely additive.
 */

const { esc } = require('../lib/escape');

// "services.html" / "/services.html" / "services" all reduce to "services".
function slugOf(href) {
  return String(href == null ? '' : href).replace(/\.html$/, '').replace(/^\//, '');
}

module.exports = function nav(site, currentSlug) {
  const isCurrent = slug =>
    slug === currentSlug || (currentSlug === 'index' && (slug === '' || slug === 'index'));

  const links = (site.nav.links || []).map(link => {
    const children = Array.isArray(link.children) ? link.children : [];
    const active = (isCurrent(slugOf(link.href)) || children.some(c => isCurrent(slugOf(c.href))))
      ? ' class="active"' : '';

    if (!children.length) {
      return `<a href="${esc(link.href)}"${active}>${esc(link.label)}</a>`;
    }

    // The caret lives INSIDE the anchor so it tracks the label and a click on
    // it still goes to the hub page; aria-hidden keeps it out of the link's
    // accessible name.
    const parent = `<a href="${esc(link.href)}"${active}>${esc(link.label)}<span class="nav-caret" aria-hidden="true">▾</span></a>`;
    const subLinks = children.map(child =>
      `<a href="${esc(child.href)}"${isCurrent(slugOf(child.href)) ? ' class="active"' : ''}>${esc(child.label)}</a>`
    ).join('\n            ');

    return `<span class="nav-item">
          ${parent}
          <span class="nav-sub">
            ${subLinks}
          </span>
        </span>`;
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
