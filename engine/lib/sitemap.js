/* ============================================================
   engine/lib/sitemap.js — Editable site map builder

   Produces a compact "edit map" of a client's content: every block
   and ADDRESSABLE repeating item (one that carries an id) by id, the
   editable field names, and a SHORT preview of each current value.
   Shown to the maintenance model instead of the whole content.json.

   v2: the map opens with a THEME TOKENS section listing every token
   in the SAFE_TOKENS allowlist with its current EFFECTIVE value
   (theme preset merged with site.themeOverrides). This is what the
   model sees when an owner asks "change our brand color". Pass the
   theme's tokens.json object as the optional second argument; both
   functions remain backward-compatible when it is omitted.

   Exports:
     buildEditMap(content [, presetTokens])  -> structured object (for a UI)
     renderEditMap(content [, presetTokens]) -> plain-text outline (for a model prompt)
   ============================================================ */

'use strict';

const { SAFE_TOKENS, creatableFieldsFor } = require('./patch');

const PREVIEW_LEN = 200;

function preview(v) {
  if (typeof v === 'string') return v.length > PREVIEW_LEN ? v.slice(0, PREVIEW_LEN) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function pickLabel(item) {
  for (const key of ['title', 'heading', 'attribution', 'name', 'label', 'question', 'day']) {
    if (typeof item[key] === 'string') return { key, value: item[key] };
  }
  for (const k of Object.keys(item)) {
    if (k !== 'id' && typeof item[k] === 'string') return { key: k, value: item[k] };
  }
  return null;
}

// True only for an array whose elements are objects that ALL carry a string id.
// These are the only arrays a maintenance edit may address by item id.
// All-or-nothing by design: if any element lacks a string id, the whole array
// falls through to the structural-array path and is not exposed in the edit map.
// If items in a new block type aren't appearing, confirm every element has a
// string "id" field.
function isAddressableItemArray(v) {
  return Array.isArray(v) && v.length > 0 &&
    v.every(el => el && typeof el === 'object' && !Array.isArray(el) && typeof el.id === 'string');
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(el => typeof el === 'string');
}

// Collect scalar leaf paths under the site object (skips structural arrays).
// themeOverrides is deliberately skipped: tokens surface in the THEME TOKENS
// section and are written only via set-token, never via plain set.
function siteFields(site) {
  const out = [];
  (function walk(obj, prefix) {
    for (const k of Object.keys(obj)) {
      if (k === 'id' || k === 'type') continue;
      if (!prefix && k === 'themeOverrides') continue;
      const v    = obj[k];
      const path = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) continue;                 // nav/footer arrays: developer-managed
      if (v && typeof v === 'object') walk(v, path);
      else out.push({ field: path, preview: preview(v) });
    }
  })(site, '');
  return out;
}

// Effective value of each safe token: client override > theme preset > unknown.
function tokenEntries(content, presetTokens) {
  const overrides = (content && content.site && content.site.themeOverrides) || {};
  return Object.keys(SAFE_TOKENS).map(name => ({
    token: '--' + name,
    type:  SAFE_TOKENS[name],
    value: overrides[name] != null ? String(overrides[name])
         : (presetTokens && presetTokens[name] != null ? String(presetTokens[name]) : null),
  }));
}

// Describe one block's editable surface.
function describeBlock(block) {
  const fields   = block.fields || {};
  const scalars  = [];
  const textLists = [];
  const itemSets = [];

  for (const name of Object.keys(fields)) {
    const v = fields[name];
    // The per-block visibility flag is DELIBERATELY not a scalar here: it has
    // no rendered element to annotate (proof 1 requires an annotation for
    // every non-dotted scalar), so it surfaces as block-level metadata below
    // and the UI reaches it through the editor pane's section toggle.
    if (name === 'hidden' && typeof v === 'boolean') continue;
    // A header background's focal point + zoom (hero or page-header) are the
    // same shape: no clickable element of their own (they paint as inline style
    // on the .hero-bg / .page-header-bg layer), edited through the image
    // editor's drag handle + slider rather than a per-element
    // click. Excluding them here keeps the annotator and the proof's required
    // surface in sync by construction — neither will demand an annotation no
    // renderer emits. applyPatch still writes them (guarded), independent of
    // this map.
    if (name === 'bgPosition' && typeof v === 'string') continue;
    if (name === 'bgZoom' && typeof v === 'number') continue;
    if (isAddressableItemArray(v)) {
      // Repeating object items with ids -> addressed by id. An item normally
      // exposes each of its own scalar fields as a separately-clickable element
      // (an faq's question and answer render as two elements, each annotated).
      // A CTA button is the exception: its label/href/style all render on ONE
      // <a>, so only `label` carries the click annotation (the
      // one-element-one-annotation scheme — see engine/lib/annotate.js COVERAGE
      // SCOPE); href and style are reached through the button editor that opens
      // from that click, never a per-element click of their own. Keying on the
      // field name keeps proof 1's required-annotation set in sync with what
      // hero.js actually annotates.
      const items = v.map(it => ({
        id:     it.id,
        label:  pickLabel(it),
        fields: name === 'actions'
          ? Object.keys(it).filter(k => k === 'label')
          : Object.keys(it).filter(k => k !== 'id' && k !== 'type'),
      }));
      itemSets.push({ field: name, items });
    } else if (isStringArray(v) && v.length) {
      // Flat string list -> edited by text match, not index
      textLists.push({
        field: name,
        lines: v.map(s => ({ preview: preview(s), truncated: s.length > PREVIEW_LEN })),
      });
    } else if (Array.isArray(v)) {
      // Array of objects WITHOUT ids (button actions, form fields, footer columns):
      // structural / developer-managed — intentionally not exposed as editable.
      continue;
    } else if (v !== null && typeof v === 'object') {
      // Nested object field — list its scalar leaves.
      for (const k of Object.keys(v)) {
        if (typeof v[k] !== 'object') scalars.push({ field: `${name}.${k}`, preview: preview(v[k]) });
      }
    } else {
      scalars.push({ field: name, preview: preview(v) });
    }
  }
  // CREATABLE fields the block currently OMITS — the editable surface a click
  // can't reach because nothing renders for an absent value. Two kinds, by the
  // descriptor's whenAbsent (see patch.js CREATABLE_FIELDS):
  //   'inherits' — a rendered element exists even when omitted (a page-header
  //     background inherits the site hero and always paints a bg div). Add it
  //     to `scalars` so it stays click-reachable, exactly as before; proof 1's
  //     annotation requirement is satisfied by that always-rendered element.
  //   'omitted'  — no element renders for an absent value (a subhead). It can't
  //     be a scalar (proof 1 would demand an annotation no renderer emits), so
  //     it surfaces in `creatable` — the doorway the Section panel reads.
  const creatable = [];
  for (const c of creatableFieldsFor(block.type)) {
    if (Object.prototype.hasOwnProperty.call(fields, c.field)) continue; // present → handled above
    if (c.whenAbsent === 'inherits') {
      if (!scalars.some(s => s.field === c.field)) scalars.push({ field: c.field, preview: null });
    } else {
      creatable.push({ field: c.field, kind: c.kind });
    }
  }

  return {
    id: block.id, type: block.type, scalars, textLists, itemSets, creatable,
    // null = the flag is not seeded on this block (no toggle to offer);
    // true/false = the owner-togglable visibility state.
    hidden: typeof fields.hidden === 'boolean' ? fields.hidden : null,
  };
}

function buildEditMap(content, presetTokens) {
  const map = {
    tokens: tokenEntries(content, presetTokens),
    site:   siteFields((content && content.site) || {}),
    pages:  [],
  };
  for (const page of (content && content.pages) || []) {
    map.pages.push({ slug: page.slug, blocks: (page.blocks || []).map(describeBlock) });
  }
  return map;
}

function renderEditMap(content, presetTokens) {
  const m = buildEditMap(content, presetTokens);
  const L = [];
  L.push('THEME TOKENS  (brand appearance — edit ONLY with action:"set-token")');
  for (const t of m.tokens) {
    const hint = t.type === 'opacity' ? '  (number 0–1 or %)' : '  (color)';
    L.push(`  ${t.token}${t.value != null ? `  = "${t.value}"` : '  = (theme default)'}${hint}`);
  }
  L.push('');
  L.push('SITE  (use block:"site")');
  for (const f of m.site) L.push(`  field: ${f.field}${f.preview != null ? `  = "${f.preview}"` : ''}`);
  for (const page of m.pages) {
    L.push('');
    L.push(`PAGE ${page.slug}`);
    for (const b of page.blocks) {
      L.push(`  block "${b.id}" (${b.type})`);
      for (const s of b.scalars) L.push(`    field: ${s.field}${s.preview != null ? `  = "${s.preview}"` : ''}`);
      for (const tl of b.textLists) {
        L.push(`    text-list field: ${tl.field}  (edit a line by matching its text exactly)`);
        for (const line of tl.lines) {
          L.push(`      - "${line.preview}"${line.truncated ? '   [truncated — cannot be matched; do not edit this line]' : ''}`);
        }
      }
      for (const is of b.itemSets) {
        L.push(`    items in "${is.field}":`);
        for (const it of is.items) {
          const lbl = it.label ? `  ${it.label.key}: "${it.label.value}"` : '';
          L.push(`      item "${it.id}"${lbl}  — fields: ${it.fields.join(', ')}`);
        }
      }
      if (b.creatable && b.creatable.length) {
        L.push(`    can add: ${b.creatable.map(c => c.field).join(', ')}`);
      }
    }
  }
  return L.join('\n');
}

module.exports = { buildEditMap, renderEditMap };
