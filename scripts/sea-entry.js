'use strict';
/* ============================================================
   scripts/sea-entry.js — the script embedded in the single-file
   editor runtime (blockson-editor.exe; built by build-sea.js).

   The exe is "Node without an install": it emulates

       node <script.js> [args...]

   for the engine's entry points, so a machine with no Node can run

       blockson-editor.exe engine\serve.js <client>
       blockson-editor.exe engine\build.js <client>

   Design (docs/handover/4-sea-build.md): the repo ships AS FILES;
   nothing moves into the binary. This script loads the requested
   engine script FROM DISK via module.createRequire, so every module
   behaves exactly as under `node`: __dirname is its real directory,
   node_modules resolves from the repo as usual, and
   spawnSync(process.execPath, [script, ...]) in engine/lib/host-node.js
   re-enters this launcher in a fresh child process — preserving the
   "builds are spawned, never require()d" isolation unchanged.

   Only Node builtins may be required directly here (SEA rule); the
   disk require is created per-target, anchored at the target's path.

   BLOCKSON_SEA_PROBE=1 prints the raw and normalized argv as JSON and
   exits — used by build-sea.js to self-verify a fresh exe, and handy
   if a future Node changes the SEA argv layout.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('node:module');

/* In a SEA, process.argv[1] is the executable path again (where `node`
   would put the script path); user args start at index 2. Detect rather
   than assume, so a future layout change degrades to a clear error, not
   a silently eaten first argument. */
const argvHasExeTwice =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(process.argv[0]);
const rawArgs = process.argv.slice(argvHasExeTwice ? 2 : 1);

if (process.env.BLOCKSON_SEA_PROBE === '1') {
  process.stdout.write(JSON.stringify({ argv: process.argv, rawArgs }) + '\n');
  process.exit(0);
}

const script = rawArgs[0];

function usage(problem) {
  process.stderr.write(
    (problem ? problem + '\n\n' : '') +
    'Blockson editor runtime — Node.js bundled as one file.\n' +
    'Runs an engine script exactly like `node <script>` would:\n\n' +
    '  blockson-editor.exe engine\\serve.js <client>   start the owner editor\n' +
    '  blockson-editor.exe engine\\build.js <client>   build a site into dist\\\n\n' +
    'Run it from the site folder (the folder that contains engine\\).\n'
  );
  process.exit(1);
}

if (!script) usage();
const target = path.resolve(process.cwd(), script);
if (!fs.existsSync(target)) {
  usage(`Can't find "${script}" (looked at ${target}).`);
}

/* Present node-style argv to the target: [execPath, scriptPath, ...args].
   Engine scripts read process.argv.slice(2), same as under `node`. */
process.argv = [process.argv[0], target, ...rawArgs.slice(1)];

createRequire(target)(target);
