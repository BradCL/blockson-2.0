#!/usr/bin/env node
'use strict';
/* ============================================================
   engine/blueprints-check.js — Whole-registry check + demo gallery

   Usage: npm run blueprints:check   (node engine/blueprints-check.js)

   1. Runs the full acceptance pipeline (engine/lib/bpcheck.js) on every
      file in blueprints/ — the same gate validate-blueprint.js applies
      to a single file.
   2. Regenerates clients/blueprint-gallery/content.json: every
      blueprint × every variant instantiated from its example inputs.
      The file is COMMITTED — it is the visual gallery for theme work
      and the regression corpus for the proof suite. Proof 11 fails the
      build when the committed file drifts from regeneration, so adding
      or changing a blueprint means rerunning this and committing.
   3. Builds the gallery live and re-checks the live-output invariant
      (no data-bk-*, no id attributes).

   Exit 0 only when every blueprint passes and the gallery builds clean.
   ============================================================ */

const fs   = require('fs');
const path = require('path');
const scaffold = require('./lib/scaffold');
const bpcheck  = require('./lib/bpcheck');

const ROOT = path.resolve(__dirname, '..');
let failed = false;

// ── 1. Every blueprint passes the acceptance pipeline ──────────
const reg = scaffold.loadBlueprints();
for (const inv of reg.invalid) {
  failed = true;
  console.log(`\nblueprints/${inv.file} — INVALID`);
  for (const e of inv.errors) console.log(`  ✗ ${e}`);
}
for (const { file } of reg.blueprints) {
  const r = bpcheck.checkBlueprint(path.join('blueprints', file));
  console.log(`\nblueprints/${file} — ${r.name}`);
  for (const c of r.checks) console.log(`  ✓ ${c}`);
  if (!r.ok) {
    failed = true;
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    console.log('  FAIL');
  } else {
    console.log('  PASS');
  }
}
if (failed) {
  console.log('\nblueprints:check FAILED — gallery not regenerated.');
  process.exit(1);
}

// ── 2. Regenerate the demo gallery client ──────────────────────
const demo = bpcheck.demoContent();
if (!demo.ok) {
  for (const e of demo.errors) console.log(`✗ ${e}`);
  process.exit(1);
}
const galleryDir  = path.join(ROOT, 'clients', bpcheck.GALLERY_CLIENT);
const galleryFile = path.join(galleryDir, 'content.json');
const next = JSON.stringify(demo.content, null, 2) + '\n';
const prev = fs.existsSync(galleryFile) ? fs.readFileSync(galleryFile, 'utf8') : null;
fs.mkdirSync(galleryDir, { recursive: true });
fs.writeFileSync(galleryFile, next, 'utf8');
console.log(`\nclients/${bpcheck.GALLERY_CLIENT}/content.json ${prev === next ? 'unchanged' : prev === null ? 'created — commit it' : 'UPDATED — commit it'}`);
console.log(`  ${demo.created.length} page(s): ${demo.created.map(c => `${c.blueprint}/${c.variant}`).join(', ')}`);

// ── 3. Build the gallery live; re-check the live invariant ─────
const b = bpcheck.build(bpcheck.GALLERY_CLIENT);
if (!b.ok) {
  console.log(`✗ gallery build failed:\n${b.out}`);
  process.exit(1);
}
console.log(`  ${b.out}`);
const distDir = path.join(ROOT, 'dist', bpcheck.GALLERY_CLIENT);
for (const f of fs.readdirSync(distDir).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(distDir, f), 'utf8');
  if (html.includes('data-bk-')) { console.log(`✗ live gallery ${f} contains data-bk-*`); failed = true; }
}
for (const c of demo.created) {
  const html = fs.readFileSync(path.join(distDir, c.file), 'utf8');
  for (const id of c.blockIds) {
    if (html.includes(`id="${id}"`)) { console.log(`✗ live gallery ${c.file} leaks block id "${id}"`); failed = true; }
  }
}
if (failed) process.exit(1);

console.log(`\nblueprints:check PASSED — ${reg.blueprints.length} blueprint(s) validated, gallery rebuilt (dist/${bpcheck.GALLERY_CLIENT}/).`);
