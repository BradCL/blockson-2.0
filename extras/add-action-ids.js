#!/usr/bin/env node
'use strict';
/* ============================================================
   extras/add-action-ids.js — One-time CTA-button id migration

   The engine addresses every repeating item BY ID, never by index. A
   hero's `actions` are an object array { label, href, style } that shipped
   WITHOUT ids, so the editor treated them as developer-managed structure:
   the buttons were not click-editable and could not be added or removed.
   Giving each action an id turns that array into an addressable item set,
   exactly like cards or faqs — so the owner can edit a button's text,
   change its link/style, and add or remove buttons.

   The migration is GRACEFUL (the `id` is OPTIONAL in the schema, mirroring
   the visibility-flag precedent): un-migrated actions still validate and
   build; the array simply stays non-editable until EVERY action in it
   carries an id. This script seeds an id — slugified from the button's
   label, made unique site-wide against every id already present (block ids
   and item ids alike) — onto every hero action that lacks one. Idempotent:
   an action that already has an id is left untouched, so running it twice
   changes nothing.

   Usage:
     node extras/add-action-ids.js <client-name> [<client-name> …]
     node extras/add-action-ids.js clients/<name>/content.json

   Rebuild afterwards (node engine/build.js <client-name>) — the live output
   is byte-identical to before (hero.js renders only label/href/style; the
   id is never emitted). The ANNOTATED preview build now marks each button as
   editable — that is the whole point.

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
  console.error('Usage: node extras/add-action-ids.js <client-name | path/to/content.json> …');
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
  // action ids are uniqued against this set AND against each other as we go.
  const taken = collectAllIds(content);
  let added = 0;
  for (const page of content.pages || []) {
    for (const block of page.blocks || []) {
      if (!block || block.type !== 'hero') continue;
      const actions = block.fields && block.fields.actions;
      if (!Array.isArray(actions)) continue;
      for (const action of actions) {
        if (!action || typeof action !== 'object' || Array.isArray(action)) continue;
        if (typeof action.id === 'string') continue; // already migrated — leave it
        const base = slugify(action.label || '') || 'button';
        const id = uniqueName(base, taken);
        taken.add(id);
        action.id = id;
        added++;
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n', 'utf8');
  console.log(`${path.relative(ROOT, file)}: seeded an id on ${added} hero button(s)${added === 0 ? ' (already migrated)' : ''}`);
}
process.exit(failed ? 1 : 0);
