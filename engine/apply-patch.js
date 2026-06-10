#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyPatch } = require('./lib/patch');
const { repairPatch } = require('./lib/repair');

const ROOT = path.resolve(__dirname, '..');

const clientName = process.argv[2];
const patchArg   = process.argv[3];

if (!clientName || !patchArg) {
  console.error('Usage: node engine/apply-patch.js <client> \'<patch-json>\'');
  process.exit(1);
}

// Step 1: Read content.json; keep a backup string for rollback.
const contentPath = path.join(ROOT, 'clients', clientName, 'content.json');
if (!fs.existsSync(contentPath)) {
  console.error(`Error: ${contentPath} not found`);
  process.exit(1);
}
const originalText = fs.readFileSync(contentPath, 'utf8');
let content;
try {
  content = JSON.parse(originalText);
} catch (e) {
  console.error(`Error: content.json is not valid JSON — ${e.message}`);
  process.exit(1);
}

// Step 2: Parse patch.
let patch;
try {
  patch = JSON.parse(patchArg);
} catch (e) {
  console.error(`Error: patch argument is not valid JSON — ${e.message}`);
  process.exit(1);
}

// v3: deterministic repair pass — normalizes known near-miss shapes
// (e.g. a site field name written into "block") before the resolver.
// Grants no new capability; the resolver below still gates everything.
const repaired = repairPatch(content, patch);
for (const note of repaired.repairs) console.log(`Repaired: ${note}`);
patch = repaired.patch;

// Load the theme preset so the set-token contrast guard can check the
// new value against effective paired colors.
let presetTokens = null;
const themeName = (content.site && content.site.theme) || 'default';
const tokensPath = path.join(ROOT, 'themes', themeName, 'tokens.json');
if (fs.existsSync(tokensPath)) {
  try { presetTokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8')); } catch (e) { /* guard degrades gracefully */ }
}

// Apply patch (mutates content on success). set-token actions flow through
// the exact same resolver → write → rebuild → restore cycle as content edits.
const result = applyPatch(content, patch, presetTokens);

// Step 3: Refused — not an error, just not allowed.
if (result.refused) {
  console.log(`Refused: ${result.reason}`);
  process.exit(0);
}

// Step 4: Error — print and exit non-zero, write nothing.
if (!result.ok) {
  console.error(`Error: ${result.error}`);
  process.exit(1);
}

// Step 5: Write mutated content back, then rebuild as final validation gate.
const newText = JSON.stringify(content, null, 2) + '\n';
fs.writeFileSync(contentPath, newText, 'utf8');

const buildResult = spawnSync('node', [path.join(__dirname, 'build.js'), clientName], {
  cwd: ROOT,
  stdio: 'pipe',
});
if (buildResult.status !== 0) {
  fs.writeFileSync(contentPath, originalText, 'utf8');
  const stderr = buildResult.stderr ? buildResult.stderr.toString().trim() : 'unknown build error';
  console.error(`Build failed after patch; content.json restored.\n${stderr}`);
  process.exit(1);
}

// Step 6: Report what changed.
if (result.action === 'set-token') {
  console.log(`OK: set-token ${result.token} = "${patch.value}" → rebuilt ${clientName}/`);
} else {
  const blockLabel = patch.item ? `${patch.block} › ${patch.item}` : patch.block;
  const fieldLabel = patch.match != null
    ? `${patch.field} [match "${patch.match}"]`
    : patch.field;
  console.log(`OK: ${result.action} ${blockLabel}.${fieldLabel} → rebuilt ${clientName}/`);
}
