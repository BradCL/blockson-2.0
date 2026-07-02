'use strict';
/* ============================================================
   scripts/build-sea.js — build the single-file editor runtime
   (npm run build:exe)

   Produces build/sea/blockson-editor.exe: the Node runtime with
   scripts/sea-entry.js embedded via Node's Single Executable
   Application support (docs/handover/4-sea-build.md). The exe
   replaces the `node` command on a machine with no Node install;
   the repo itself still ships as ordinary files next to it.

   Steps (the official SEA recipe, scripted so it never lives in
   anyone's head):
     1. node --experimental-sea-config  → the injectable blob
     2. copy this Node's own binary    → build/sea/blockson-editor.exe
     3. postject                       → inject the blob into the copy
     4. self-check: run the fresh exe with BLOCKSON_SEA_PROBE=1 and
        confirm it normalizes argv the way engine scripts expect —
        a build that would eat the first argument fails loudly here.

   Notes:
   - Injection invalidates the Node binary's Authenticode signature.
     Windows runs it fine (unknown publisher); re-signing is the
     code-signing step in 4-sea-build.md, not this script's job.
   - Developed and tested on Windows; on other platforms the exe
     name simply drops ".exe" (macOS additionally needs its
     signature removed/re-added — see the Node SEA docs).
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build', 'sea');
const BLOB = path.join(OUT_DIR, 'sea-prep.blob');
const EXE_NAME = process.platform === 'win32' ? 'blockson-editor.exe' : 'blockson-editor';
const EXE = path.join(OUT_DIR, EXE_NAME);
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function fail(msg, detail) {
  console.error(`build:exe FAILED — ${msg}`);
  if (detail) console.error(detail.trim());
  process.exit(1);
}

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error) fail(`${label}: ${r.error.message}`);
  if (r.status !== 0) fail(label, (r.stdout || '') + (r.stderr || ''));
  return r;
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) fail(`Node ${process.versions.node} is too old — SEA needs Node 20+.`);

console.log(`Building ${EXE_NAME} with Node ${process.versions.node}…`);
fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. Generate the SEA blob from scripts/sea-config.json.
run('blob generation', process.execPath,
  ['--experimental-sea-config', path.join('scripts', 'sea-config.json')]);

// 2. Start from a copy of the running Node binary itself.
fs.rmSync(EXE, { force: true });
fs.copyFileSync(process.execPath, EXE);

// 3. Inject the blob (postject is a devDependency; resolve its CLI directly
//    so the build never depends on npx or the network).
run('postject injection', process.execPath, [
  require.resolve('postject/dist/cli.js'),
  EXE, 'NODE_SEA_BLOB', BLOB, '--sentinel-fuse', FUSE,
]);

// 4. Self-check: the exe must see and normalize argv correctly.
const probe = spawnSync(EXE, ['engine/serve.js', '--probe-arg'], {
  cwd: ROOT, encoding: 'utf8',
  env: { ...process.env, BLOCKSON_SEA_PROBE: '1' },
});
if (probe.error) fail(`probe run: ${probe.error.message}`);
let parsed;
try { parsed = JSON.parse(probe.stdout); } catch (e) {
  fail('probe did not return JSON — the embedded entry is not running',
    (probe.stdout || '') + (probe.stderr || ''));
}
const want = ['engine/serve.js', '--probe-arg'];
if (JSON.stringify(parsed.rawArgs) !== JSON.stringify(want)) {
  fail(`argv normalization is wrong — expected ${JSON.stringify(want)}, ` +
    `got ${JSON.stringify(parsed.rawArgs)} (raw argv: ${JSON.stringify(parsed.argv)})`);
}

const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(1);
console.log(`OK: ${path.relative(ROOT, EXE)} (${mb} MB, argv self-check passed)`);
console.log('To use with the owner launcher, copy it to the repo root.');
