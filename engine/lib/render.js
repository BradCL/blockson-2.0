'use strict';

const head    = require('../partials/head');
const nav     = require('../partials/nav');
const footer  = require('../partials/footer');
const BLOCKS  = require('../blocks/_registry');
const { NOOP_BLOCK, NOOP_SITE } = require('../lib/annotate');
const { renderBodyStartTags, renderBodyEndTags } = require('./integrations');

// `annotator` is omitted for live builds (NOOP_* are substituted, so output
// is byte-identical and carries no data-bk-* attributes) and supplied only
// for annotated preview builds (engine/lib/annotate.js).
function renderPage(page, site, tokens, annotator) {
  const siteBk = annotator ? annotator.site : NOOP_SITE;
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  // An owner preview must never count marketing visits or run a client's CRM
  // bridge. Live builds alone receive integration markup; the form itself still
  // renders in previews, so ordinary content editing remains representative.
  const includeIntegrations = !annotator;
  parts.push(head(page, site, tokens, includeIntegrations));
  parts.push('<body>');
  if (includeIntegrations) {
    const bodyStart = renderBodyStartTags(site);
    if (bodyStart) parts.push(bodyStart); // first node after the opening body
  }
  parts.push(nav(site, page.slug));

  let renderedBlockCount = 0;
  for (const block of page.blocks) {
    const mod = BLOCKS[block.type];
    if (!mod) throw new Error(`Unknown block type "${block.type}" on block id "${block.id}"`);
    const hidden = !!(block.fields && block.fields.hidden === true);
    // A hidden block is absent from LIVE output entirely. In the ANNOTATED
    // preview it still renders (so the owner can click it and unhide it),
    // stamped data-bk-hidden for the overlay's dimmed/badged treatment.
    if (hidden && !annotator) continue;
    const bk = annotator ? annotator.forBlock(block.id) : NOOP_BLOCK;
    // A block may need to know only whether it is the first section visitors
    // actually see (fixed-navigation clearance is the motivating case). Extra
    // arguments are ignored by every existing renderer, preserving their output.
    let html = mod(block.fields, site, bk, {
      isFirstRenderedBlock: renderedBlockCount === 0,
    });
    if (hidden) html = html.replace(/^(\s*<[a-zA-Z][a-zA-Z0-9-]*)/, '$1 data-bk-hidden="true"');
    parts.push(html);
    renderedBlockCount++;
  }

  parts.push(footer(site, siteBk));
  if (includeIntegrations) {
    const bodyEnd = renderBodyEndTags(site);
    if (bodyEnd) parts.push(bodyEnd); // last script before the closing body
  }
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n');
}

module.exports = { renderPage };
