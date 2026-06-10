'use strict';
/* ============================================================
   test-lib.js — Shared utilities for test harnesses

   Centralises ensureCandidate, runBuild, and cleanup so that a
   fix in any of them applies everywhere.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CANDIDATE_CLIENT = '_candidate';

// Reset the candidate client folder to a fresh copy of the source.
function ensureCandidate(root, sourceDir) {
  const candidateDir = path.join(root, 'clients', CANDIDATE_CLIENT);
  fs.rmSync(candidateDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, candidateDir, { recursive: true });
}

// Build the candidate client and return {pass, output}.
function runBuild(root) {
  try {
    const out = execFileSync('node', ['engine/build.js', CANDIDATE_CLIENT],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { pass: true, output: out.trim() };
  } catch (e) {
    return { pass: false, output: [e.stdout, e.stderr].filter(Boolean).join('\n').trim() || String(e) };
  }
}

// Remove the candidate client and its dist output.
function cleanup(root) {
  fs.rmSync(path.join(root, 'clients', CANDIDATE_CLIENT), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'dist', CANDIDATE_CLIENT), { recursive: true, force: true });
}

module.exports = { ensureCandidate, runBuild, cleanup, CANDIDATE_CLIENT };
