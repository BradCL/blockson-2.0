/* ============================================================
   engine/lib/annotate.js — Preview-only edit annotations (v4)

   Produces the data-bk-* attributes that mark every editable element
   in an ANNOTATED build (node engine/build.js <client> --annotate).
   The owner UI (Task 2) injects an overlay that reads these attributes
   to know what is clickable and which editor to open.

   SINGLE SOURCE OF TRUTH — by construction, not convention.
   The annotator is built FROM buildEditMap(content) (engine/lib/sitemap.js),
   the exact same map the resolver's editable surface is derived from. Every
   annotation method is GATED against that map: a renderer that asks to
   annotate a field the map does not report gets back an empty string. So
   the UI can never offer to edit something the engine will not accept, and
   the engine's editable surface can never silently grow past what the UI
   exposes. Proof 1 enforces the other direction: every field the map
   reports must appear as an annotation in the rendered HTML.

   ANNOTATION SCHEME (one (block, item?, field) triple per element):
     - block scalar field:   data-bk-block, data-bk-field
     - addressable item field: data-bk-block, data-bk-item, data-bk-field
     - text-list line:        data-bk-block, data-bk-field, data-bk-index
     - site field:            data-bk-block="site", data-bk-field

   Live builds pass NO annotator; render.js substitutes NOOP_BLOCK /
   NOOP_SITE, whose methods all return '' — so a live build's HTML is
   byte-identical to the pre-v4 output and carries no data-bk-* anywhere
   (the live half of proof 1).

   COVERAGE SCOPE (see SPEC §12): annotations live on the per-element
   click-to-edit surface. Two classes of edit-map field are editable by
   the engine but have no dedicated clickable element, so they are gated
   (any annotation present is valid) but NOT required by the proof:
     - site config fields rendered only into <head>/attributes
       (baseUrl, theme, logo.*) — reached via a settings affordance;
     - dotted object-leaf block scalars that share one rendered element
       (e.g. button.label / button.href / button.style on one <a>).
   ============================================================ */

'use strict';

const { buildEditMap } = require('./sitemap');
const { escAttr } = require('./escape');

// Build one " name=\"value\"" pair (leading space so it splices straight
// into an opening tag right after the tag name or an existing attribute).
function attr(name, value) {
  return ` ${name}="${escAttr(String(value))}"`;
}

// No-op annotators for live builds: every method returns ''.
const NOOP_BLOCK = { f: () => '', i: () => '', l: () => '', bg: () => '' };
const NOOP_SITE  = { f: () => '' };

// Block-scoped annotator built from one block's edit-map descriptor.
function blockAnnotator(blockId, desc) {
  const scalarSet = new Set((desc.scalars || []).map(s => s.field));
  const listSet   = new Set((desc.textLists || []).map(t => t.field));
  const itemFieldSet = new Set();
  for (const is of desc.itemSets || []) {
    for (const it of is.items || []) {
      for (const fld of it.fields || []) itemFieldSet.add(it.id + ' ' + fld);
    }
  }
  return {
    // Block scalar field.
    f(field) {
      return scalarSet.has(field)
        ? attr('data-bk-block', blockId) + attr('data-bk-field', field)
        : '';
    },
    // A section-background scalar field (hero / page-header). Same gated
    // annotation as f(), plus the data-bk-bg marker the overlay uses to make a
    // behind-content background reachable from a dead-space click in its
    // section (it is painted under the content with a negative z-index, so it
    // never becomes the click target). Marker rides the annotated preview
    // only — a live build's NOOP_BLOCK.bg returns '' — so it cannot leak live.
    bg(field) {
      return scalarSet.has(field)
        ? attr('data-bk-block', blockId) + attr('data-bk-field', field) + attr('data-bk-bg', '')
        : '';
    },
    // Addressable item field (item addressed by its id).
    i(itemId, field) {
      return itemFieldSet.has(itemId + ' ' + field)
        ? attr('data-bk-block', blockId) + attr('data-bk-item', itemId) + attr('data-bk-field', field)
        : '';
    },
    // One line of a flat text list, addressed by index.
    l(field, index) {
      return listSet.has(field)
        ? attr('data-bk-block', blockId) + attr('data-bk-field', field) + attr('data-bk-index', index)
        : '';
    },
  };
}

// Build a page-level annotator from a client's content (and optional theme
// tokens, only so the underlying edit map resolves correctly — tokens
// themselves are not element-annotated).
function buildAnnotator(content, presetTokens) {
  const map = buildEditMap(content, presetTokens);
  const byId = new Map();
  for (const page of map.pages || []) {
    for (const b of page.blocks || []) byId.set(b.id, b);
  }
  const siteSet = new Set((map.site || []).map(s => s.field));
  return {
    enabled: true,
    forBlock(id) {
      const desc = byId.get(id);
      return desc ? blockAnnotator(id, desc) : NOOP_BLOCK;
    },
    site: {
      f(field) {
        return siteSet.has(field)
          ? attr('data-bk-block', 'site') + attr('data-bk-field', field)
          : '';
      },
    },
  };
}

module.exports = { buildAnnotator, NOOP_BLOCK, NOOP_SITE };
