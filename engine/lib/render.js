'use strict';

const head    = require('../partials/head');
const nav     = require('../partials/nav');
const footer  = require('../partials/footer');
const BLOCKS  = require('../blocks/_registry');

function renderPage(page, site, tokens) {
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push(head(page, site, tokens));
  parts.push('<body>');
  parts.push(nav(site, page.slug));

  for (const block of page.blocks) {
    const mod = BLOCKS[block.type];
    if (!mod) throw new Error(`Unknown block type "${block.type}" on block id "${block.id}"`);
    parts.push(mod(block.fields, site));
  }

  parts.push(footer(site));
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n');
}

module.exports = { renderPage };
