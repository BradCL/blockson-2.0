'use strict';

/* ============================================================
   engine/lib/heroimage.js — the site hero image, derived once

   The site hero image is the home page's hero background, else the
   first hero background anywhere. Two things inherit it, and both are
   load-bearing:
     - a page-header that omits its own `background` (BLOCK_CATALOG.md),
     - the default og:image (partials/head.js), where the fallback below
       it is the logo — which as a transparent one-color PNG often makes
       a broken-looking social card.

   This lived in three places at once (build.js, lib/owner.js and
   lib/host-browser.js) because build.js is an entry script that runs a
   build when required, so the others could not import it. A plain lib
   module both can require removes the copies — which matters here more
   than tidiness: the list of block types that COUNT as a hero now has
   more than one entry, and three copies would have meant three chances
   to forget one.

   `hero-form` counts. It is a hero whose call to action is a form, it
   carries the same `background` field, and a client adopting it does so
   by REPLACING their home hero — the exact case where a type-name check
   would silently drop the site's hero image, taking every page-header
   background and the og:image with it.

   Pure content interpretation: no I/O, no Node builtins, so the browser
   bundle can use it too.
   ============================================================ */

// Block types whose `background` may serve as the site hero image.
const HERO_BLOCK_TYPES = new Set(['hero', 'hero-form']);

function findSiteHeroImage(content) {
  const pages = (content && content.pages) || [];
  const heroBg = (page) => (page.blocks || [])
    .find(b => b && HERO_BLOCK_TYPES.has(b.type) && b.fields && b.fields.background);
  // Prefer the home page's hero; otherwise the first hero anywhere.
  const index = pages.find(p => p.slug === 'index');
  const hit = (index && heroBg(index)) || pages.map(heroBg).find(Boolean);
  return hit ? hit.fields.background : null;
}

module.exports = { HERO_BLOCK_TYPES, findSiteHeroImage };
