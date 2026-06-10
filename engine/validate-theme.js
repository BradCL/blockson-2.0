#!/usr/bin/env node
'use strict';
/* ============================================================
   engine/validate-theme.js — Theme acceptance CLI

   Usage: node engine/validate-theme.js <theme-dir> [more dirs…]
          node engine/validate-theme.js themes/salon
          node engine/validate-theme.js ../my-new-theme

   Runs the full acceptance pipeline on each directory
   (engine/lib/themecheck.js): token completeness → value safety
   (injection + safe-token format guards) → hard rules (no JS, no
   external resources) → contrast pairs → demo-client build under the
   candidate theme (+ per-block class coverage for themes shipping
   their own CSS). Clear pass/fail with named reasons; exit 0 only if
   every directory passes. See THEME_AUTHORING.md for the contract.
   ============================================================ */

const { checkTheme } = require('./lib/themecheck');

const dirs = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (dirs.length === 0) {
  console.error('Usage: node engine/validate-theme.js <theme-dir> [more dirs…]');
  console.error('Validates each theme: tokens → safety → hard rules → contrast → coverage build.');
  process.exit(1);
}

let failed = 0;
for (const dir of dirs) {
  const r = checkTheme(dir);
  console.log(`\n${dir} — ${r.name}`);
  for (const c of r.checks) console.log(`  ✓ ${c}`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
  if (r.ok) {
    console.log('  PASS');
  } else {
    failed++;
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    console.log('  FAIL');
  }
}
console.log(`\n${dirs.length - failed}/${dirs.length} theme(s) passed.`);
process.exit(failed === 0 ? 0 : 1);
