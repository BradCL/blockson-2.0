#!/usr/bin/env node
'use strict';

/* Launch-readiness checker for real client sites.

   It deliberately reuses engine/build.js as the source of truth: validation,
   rendering, and advisory checks all stay in one place. Doctor only turns the
   build's soft warnings into an explicit pre-launch checklist. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLIENTS_DIR = path.join(ROOT, 'clients');

function clientDirs() {
  return fs.readdirSync(CLIENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => !name.endsWith('__candidate') && name !== 'blueprint-gallery')
    .sort();
}

function usage() {
  console.error('Usage: node engine/doctor.js <client> [client...]');
  console.error('       node engine/doctor.js --all');
}

function runBuild(client) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build.js'), client],
    { cwd: ROOT, encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const warnings = out.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.includes('⚠'));
  return { ok: r.status === 0, out, warnings };
}

const args = process.argv.slice(2);
if (args.length === 0) {
  usage();
  process.exit(2);
}

const clients = args.includes('--all')
  ? clientDirs()
  : args.filter(a => !a.startsWith('--'));

if (clients.length === 0) {
  usage();
  process.exit(2);
}

let failed = false;
let warned = false;

for (const client of clients) {
  const content = path.join(CLIENTS_DIR, client, 'content.json');
  if (!fs.existsSync(content)) {
    console.log(`\n${client}`);
    console.log('  ✗ clients/' + client + '/content.json not found');
    failed = true;
    continue;
  }

  const r = runBuild(client);
  console.log(`\n${client}`);
  if (!r.ok) {
    console.log('  ✗ build failed');
    if (r.out) console.log(r.out.split(/\r?\n/).map(line => '    ' + line).join('\n'));
    failed = true;
    continue;
  }

  if (r.warnings.length) {
    warned = true;
    console.log('  ! builds, but needs launch attention:');
    for (const warning of r.warnings) {
      console.log('    - ' + warning.replace(/^⚠\s*/, ''));
    }
  } else {
    console.log('  ✓ builds with no launch advisories');
  }
}

if (failed) process.exit(1);
if (warned) process.exit(1);
process.exit(0);
