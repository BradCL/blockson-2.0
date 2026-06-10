#!/usr/bin/env node
'use strict';
/* ============================================================
   extras/add-hidden-flags.js — One-time visibility-flag migration

   Clients shipped BEFORE the per-block visibility flag (v4.2, Task 1)
   have no "hidden" field on their blocks. Absent means visible, so
   nothing is broken — but the patch resolver can never CREATE a field,
   so the owner's hide/show toggle only appears on blocks that carry
   the flag. This script seeds `"hidden": false` onto every block that
   lacks it. Idempotent: running it twice changes nothing.

   Usage:
     node extras/add-hidden-flags.js <client-name> [<client-name> …]
     node extras/add-hidden-flags.js clients/<name>/content.json

   Rebuild afterwards (node engine/build.js <client-name>) — the output
   is byte-identical to before except for the seeded flags.

   This is deploy-time material like everything in extras/: the engine
   never imports it.
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const targets = process.argv.slice(2);

if (!targets.length) {
  console.error('Usage: node extras/add-hidden-flags.js <client-name | path/to/content.json> …');
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
  let added = 0;
  for (const page of content.pages || []) {
    for (const block of page.blocks || []) {
      if (block && block.fields && typeof block.fields === 'object' && !Array.isArray(block.fields)
          && typeof block.fields.hidden !== 'boolean') {
        block.fields.hidden = false;
        added++;
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n', 'utf8');
  console.log(`${path.relative(ROOT, file)}: seeded "hidden": false on ${added} block(s)${added === 0 ? ' (already migrated)' : ''}`);
}
process.exit(failed ? 1 : 0);
