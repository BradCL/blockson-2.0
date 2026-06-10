#!/usr/bin/env node
'use strict';
/* ============================================================
   engine/validate-blueprint.js — Blueprint acceptance CLI

   Usage: node engine/validate-blueprint.js <file.json> [more files…]

   Runs the full acceptance pipeline on each file (engine/lib/bpcheck.js):
   strict schema check → sample instantiation of every variant into a
   throwaway client → full live + annotated build → id/annotation
   invariant checks. Clear pass/fail with named reasons; exit 0 only if
   every file passes. This is the gate a community blueprint must clear
   BEFORE review — see BLUEPRINT_AUTHORING.md for the authoring contract.
   ============================================================ */

const { checkBlueprint } = require('./lib/bpcheck');

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (files.length === 0) {
  console.error('Usage: node engine/validate-blueprint.js <blueprint.json> [more files…]');
  console.error('Validates each file: schema → sample instantiation → full build → invariant checks.');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const r = checkBlueprint(file);
  console.log(`\n${file} — ${r.name}`);
  for (const c of r.checks) console.log(`  ✓ ${c}`);
  if (r.ok) {
    console.log('  PASS');
  } else {
    failed++;
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    console.log('  FAIL');
  }
}
console.log(`\n${files.length - failed}/${files.length} blueprint(s) passed.`);
process.exit(failed === 0 ? 0 : 1);
