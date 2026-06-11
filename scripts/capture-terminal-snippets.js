#!/usr/bin/env node
/**
 * capture-terminal-snippets.js — reproducible terminal transcripts for the
 * developer tutorial. Each capture runs the real command and saves
 * "$ command" + its output to docs/tutorial/developer/term/NN-name.txt.
 *
 *   node scripts/capture-terminal-snippets.js
 *
 * The failed-build capture mutates the demo client's content.json (an
 * unsafe javascript: href) and restores it in a finally — the tree is
 * left exactly as found.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'tutorial', 'developer', 'term');
fs.mkdirSync(OUT, { recursive: true });

const CLIENT = 'wren-and-willow';
const CONTENT = path.join(ROOT, 'clients', CLIENT, 'content.json');

function run(args) {
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
  return { text: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

function save(name, command, output) {
  fs.writeFileSync(path.join(OUT, name), `$ ${command}\n${output.trimEnd()}\n`);
  console.log(`✓ term/${name}`);
}

async function main() {
  // 1 — proof suite passing
  {
    const r = run(['engine/_run-proofs.js']);
    if (r.status !== 0) throw new Error('proof suite failed — aborting captures');
    save('01-proofs.txt', 'node engine/_run-proofs.js', r.text);
  }

  // 2 — scaffolding a client (throwaway, removed after capture)
  {
    const scratch = path.join(ROOT, 'clients', 'demo-scratch');
    fs.rmSync(scratch, { recursive: true, force: true });
    const r = run(['engine/new-client.js', 'demo-scratch', 'trades']);
    save('02-new-client.txt', 'node engine/new-client.js demo-scratch trades', r.text);
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  // 3/4 — a build the schema gate refuses, then the fix
  {
    const original = fs.readFileSync(CONTENT, 'utf8');
    try {
      const content = JSON.parse(original);
      // The classic mistake the gate exists for: an unsafe link scheme.
      content.pages[0].blocks[0].fields.actions[0].href = 'javascript:alert(1)';
      fs.writeFileSync(CONTENT, JSON.stringify(content, null, 2));
      const fail = run(['engine/build.js', CLIENT]);
      if (fail.status === 0) throw new Error('expected the build to fail');
      save('03-build-fail.txt', `node engine/build.js ${CLIENT}`, fail.text);
    } finally {
      fs.writeFileSync(CONTENT, original);
    }
    const ok = run(['engine/build.js', CLIENT]);
    if (ok.status !== 0) throw new Error('clean rebuild failed after restore');
    save('04-build-clean.txt', `node engine/build.js ${CLIENT}`, ok.text);
  }

  // 5 — the edit map
  {
    const r = run(['engine/sitemap.js', CLIENT]);
    save('05-sitemap.txt', `node engine/sitemap.js ${CLIENT}`, r.text);
  }

  // 6 — the owner editor starting up (killed once the banner appears)
  await new Promise((resolve, reject) => {
    const child = spawn('node', ['engine/serve.js', CLIENT, '--port', '4179'], { cwd: ROOT });
    let buf = '';
    const done = () => {
      child.kill();
      save('06-serve.txt', `node engine/serve.js ${CLIENT}`, buf.replace(/4179/g, '4173'));
      resolve();
    };
    const timer = setTimeout(() => { done(); }, 20000);
    const onData = d => {
      buf += d.toString();
      if (/http:\/\/127\.0\.0\.1:\d+/.test(buf)) { clearTimeout(timer); done(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', e => { clearTimeout(timer); reject(e); });
  });

  console.log(`\nTranscripts → ${path.relative(ROOT, OUT)}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
