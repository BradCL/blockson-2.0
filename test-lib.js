'use strict';
/* ============================================================
   test-lib.js — Shared utilities for all test harnesses

   Centralises askOllama, extractJson, ensureCandidate, runBuild,
   and cleanup so that a fix in any of them applies everywhere.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CANDIDATE_CLIENT = '_candidate';

// `format`: 'json' for free-form JSON mode, a JSON Schema OBJECT for
// Ollama structured outputs (grammar-constrained decoding — see
// engine/lib/patch-schema.js), or false for plain text.
// `user` may be a string or a full messages array (used by the retry loop
// to carry the rejected patch + resolver error back to the model).
async function askOllama(model, system, user, { format = 'json' } = {}) {
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),
    Number(process.env.OLLAMA_TIMEOUT_MS || 300000)); // default 5 min
  const userMessages = Array.isArray(user)
    ? user
    : [{ role: 'user', content: user }];
  const body = {
    model, stream: false,
    options: { temperature: 0, think: false },
    messages: [
      { role: 'system', content: system },
      ...userMessages,
    ],
  };
  if (format) body.format = format;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.message && data.message.content) || '';
  } finally {
    clearTimeout(timeout);
  }
}

// Pull the first balanced top-level JSON object out of a model reply.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return body.slice(start, i + 1); }
    }
  }
  return null;
}

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

module.exports = { askOllama, extractJson, ensureCandidate, runBuild, cleanup, CANDIDATE_CLIENT };