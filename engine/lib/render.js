'use strict';

const head    = require('../partials/head');
const nav     = require('../partials/nav');
const footer  = require('../partials/footer');
const BLOCKS  = require('../blocks/_registry');
const { NOOP_BLOCK, NOOP_SITE } = require('../lib/annotate');

// `annotator` is omitted for live builds (NOOP_* are substituted, so output
// is byte-identical and carries no data-bk-* attributes) and supplied only
// for annotated preview builds (engine/lib/annotate.js).
function renderPage(page, site, tokens, annotator) {
  const siteBk = annotator ? annotator.site : NOOP_SITE;
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push(head(page, site, tokens));
  parts.push('<body>');
  parts.push(nav(site, page.slug));

  for (const block of page.blocks) {
    const mod = BLOCKS[block.type];
    if (!mod) throw new Error(`Unknown block type "${block.type}" on block id "${block.id}"`);
    const bk = annotator ? annotator.forBlock(block.id) : NOOP_BLOCK;
    parts.push(mod(block.fields, site, bk));
  }

  parts.push(footer(site, siteBk));
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n');
}

module.exports = { renderPage };
