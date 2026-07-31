#!/usr/bin/env node
'use strict';
/* ============================================================
   extras/add-filter-ids.js — One-time gallery-filter id migration

   The engine addresses every repeating item BY ID, never by index. A
   gallery's `filters` are an object array { label, value } that shipped
   WITHOUT ids, so the editor treated them as developer-managed structure:
   a tab's wording could not be edited, and — once category covers arrived —
   there was nowhere to hang the per-category cover photo either.

   Giving each filter an id turns that array into an addressable item set.
   What that exposes is deliberately narrow:
     - `label` (the tab's wording) becomes click-editable, on the tab button
       itself and again on the category cover card;
     - `cover` (the category's photo on the "All" tab) becomes click-editable
       wherever it is seeded, which is what lets an owner say "this photo
       represents Garages" without touching structure;
     - `value` does NOT. It is the join key between a filter and its albums,
       and it is refused by DEVELOPER_ONLY_FIELDS in engine/lib/patch.js —
       dropped from the edit map and rejected by applyPatch alike.

   The migration is GRACEFUL (the `id` is OPTIONAL in the schema, mirroring
   the CTA-button and visibility-flag precedents): un-migrated filters still
   validate and build; the array simply stays non-editable until EVERY
   filter in it carries an id. This script seeds an id — slugified from the
   filter's value, made unique site-wide against every id already present —
   onto every gallery filter that lacks one. Idempotent: a filter that
   already has an id is left untouched, so running it twice changes nothing.

   Usage:
     node extras/add-filter-ids.js <client-name> [<client-name> …]
     node extras/add-filter-ids.js clients/<name>/content.json

   Rebuild afterwards (node engine/build.js <client-name>) — the live output
   is byte-identical to before (gallery.js renders only label/value/cover;
   the id is never emitted). The ANNOTATED preview build now marks each tab
   as editable — that is the whole point.

   This is deploy-time material like everything in extras/: the engine never
   imports it. It reuses scaffold.js's id machinery so the ids it seeds are
   generated exactly as the scaffolder generates them.
   ============================================================ */

const fs   = require('fs');
const path = require('path');
const { collectAllIds, uniqueName, slugify } = require('../engine/lib/scaffold');

const ROOT = path.resolve(__dirname, '..');
const targets = process.argv.slice(2);

if (!targets.length) {
  console.error('Usage: node extras/add-filter-ids.js <client-name | path/to/content.json> …');
  process.exit(1);
}

let failed = false;
for (const t of targets) {
  const file = t.endsWith('.json') ? path.resolve(ROOT, t)
    : path.join(ROOT, 'clients', t, 'content.json');
  let content;
  try {
    content = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`✗ ${t}: ${e.message}`);
    failed = true;
    continue;
  }

  // Every id already in the site (block ids + item ids at any depth). New
  // filter ids are uniqued against this set AND against each other as we go.
  const taken = collectAllIds(content);
  let added = 0;
  for (const page of content.pages || []) {
    for (const block of page.blocks || []) {
      if (!block || block.type !== 'gallery') continue;
      const filters = block.fields && block.fields.filters;
      if (!Array.isArray(filters)) continue;
      for (const filter of filters) {
        if (!filter || typeof filter !== 'object' || Array.isArray(filter)) continue;
        if (typeof filter.id === 'string') continue; // already migrated — leave it
        // Slugged from `value` rather than `label`: the value is the stable
        // identity (the label is owner-editable the moment this runs), and
        // "filter-" keeps these distinct from the album ids alongside them.
        const base = 'filter-' + (slugify(filter.value || '') || 'category');
        const id = uniqueName(base, taken);
        taken.add(id);
        filter.id = id;
        added++;
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n', 'utf8');
  console.log(`${path.relative(ROOT, file)}: seeded an id on ${added} gallery filter(s)${added === 0 ? ' (already migrated)' : ''}`);
}
process.exit(failed ? 1 : 0);
