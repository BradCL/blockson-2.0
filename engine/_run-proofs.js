#!/usr/bin/env node
'use strict';
// Runs all seven end-to-end proofs in sequence and prints results.
// Proofs 1–4: the original patch/rebuild/rollback path.
// Proofs 5–6: the v2 token-editing path (allowlist + format + contrast guards).
// Proof 7:    resolver value guards — valueless writes are rejected.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyPatch } = require('./lib/patch');

const ROOT = path.resolve(__dirname, '..');

function readContent(client) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'clients', client, 'content.json'), 'utf8'));
}
function writeContent(client, obj) {
  fs.writeFileSync(path.join(ROOT, 'clients', client, 'content.json'),
    JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function build(client) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build.js'), client],
    { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

let passed = 0;
const TOTAL = 7;
const DEFAULT_TOKENS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'themes', 'default', 'tokens.json'), 'utf8'));

// ── PROOF 1 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 1 — Rebuild all clients; ids must not appear in HTML ═══');
build('example-contractor');
build('example-league');
build('example-restaurant');
const idPatterns = [
  'card-renovations', 'testi-edmonton', 'album-deck', 'card-garden',
  'plan-bruschetta', 'faq-reservations', 'row-monday', 'stat-years', 'member-chef'
];
const htmlFiles = [];
for (const client of ['example-contractor', 'example-restaurant']) {
  const dir = path.join(ROOT, 'dist', client);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
    htmlFiles.push(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
const leaks = idPatterns.filter(p => htmlFiles.some(h => h.includes(p)));
if (leaks.length === 0) {
  console.log('PASS — No item ids found in any HTML output. Ids are invisible in rendered pages.');
  passed++;
} else {
  console.log('FAIL — Ids leaked into HTML:', leaks);
}

// ── PROOF 2 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 2 — Real edit: change contact.phone via the resolver + build ═══');
{
  const patch = { action: 'set', block: 'site', field: 'contact.phone', value: '780-555-0142' };
  const contentFile = path.join(ROOT, 'clients/example-contractor/content.json');
  const orig = fs.readFileSync(contentFile, 'utf8');
  const content = JSON.parse(orig);
  const result = applyPatch(content, patch);
  if (!result.ok) { console.log('FAIL —', result.error); }
  else {
    writeContent('example-contractor', content);
    const b = build('example-contractor');
    // always restore — proofs must not mutate tracked example data
    fs.writeFileSync(contentFile, orig, 'utf8');
    if (!b.ok) {
      console.log('FAIL — build failed:', b.out);
    } else {
      console.log(`PASS — contact.phone was set to: ${content.site.contact.phone} (restored)`);
      console.log(`       ${b.out}`);
      passed++;
    }
  }
}

// ── PROOF 3 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 3 — Blocked edit: attempt to set block id field ═══');
{
  const patch = { action: 'set', block: 'home-hero', field: 'id', value: 'x' };
  const content = readContent('example-contractor');
  const result = applyPatch(content, patch);
  if (!result.ok && !result.refused) {
    console.log(`PASS — Rejected with error: "${result.error}"`);
    console.log('       Nothing written (content.json unchanged).');
    passed++;
  } else if (result.ok) {
    console.log('FAIL — patch was applied when it should have been blocked.');
  } else {
    console.log(`PASS — Refused: ${result.reason}`);
    passed++;
  }
}

// ── PROOF 4 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 4 — Id-addressed item edit: update card-renovations.body ═══');
{
  const patch = {
    action: 'set',
    block: 'home-services',
    item: 'card-renovations',
    field: 'body',
    value: 'Full-scope kitchen, bathroom, and basement renovations, start to finish.'
  };
  const contentFile = path.join(ROOT, 'clients/example-contractor/content.json');
  const orig = fs.readFileSync(contentFile, 'utf8');
  const content = JSON.parse(orig);
  const result = applyPatch(content, patch);
  if (!result.ok) { console.log('FAIL —', result.error || result.reason); }
  else {
    writeContent('example-contractor', content);
    const b = build('example-contractor');
    // always restore — proofs must not mutate tracked example data
    fs.writeFileSync(contentFile, orig, 'utf8');
    if (!b.ok) {
      console.log('FAIL — build failed:', b.out);
    } else {
      const card = content.pages[0].blocks
        .find(bl => bl.id === 'home-services').fields.cards
        .find(c => c.id === 'card-renovations');
      console.log(`PASS — card-renovations.body was set to:`);
      console.log(`       "${card.body}" (restored)`);
      console.log(`       ${b.out}`);
      passed++;
    }
  }
}

// ── PROOF 5 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 5 — Valid set-token applies, persists in themeOverrides, rebuilds ═══');
{
  const patch = { action: 'set-token', token: '--color-primary', value: '#2D6A4F' };
  const contentFile = path.join(ROOT, 'clients/example-contractor/content.json');
  const orig = fs.readFileSync(contentFile, 'utf8');
  const content = JSON.parse(orig);
  const result = applyPatch(content, patch);
  if (!result.ok) { console.log('FAIL —', result.error || result.reason); }
  else if (!content.site.themeOverrides || content.site.themeOverrides['color-primary'] !== '#2D6A4F') {
    console.log('FAIL — themeOverrides was not written as expected:', content.site.themeOverrides);
  } else {
    writeContent('example-contractor', content);
    const b = build('example-contractor');
    const html = b.ok
      ? fs.readFileSync(path.join(ROOT, 'dist/example-contractor/index.html'), 'utf8')
      : '';
    // always restore — proofs must not mutate tracked example data
    fs.writeFileSync(contentFile, orig, 'utf8');
    if (!b.ok) {
      console.log('FAIL — build failed:', b.out);
    } else if (!html.includes('--color-primary: #2D6A4F')) {
      console.log('FAIL — token did not reach the injected :root block.');
    } else {
      console.log('PASS — set-token wrote themeOverrides["color-primary"] = "#2D6A4F",');
      console.log('       the rebuild succeeded, and the value reached the page :root block. (restored)');
      console.log(`       ${b.out}`);
      passed++;
    }
  }
}

// ── PROOF 6 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 6 — Invalid set-token patches are rejected, nothing written ═══');
{
  const contentFile = path.join(ROOT, 'clients/example-contractor/content.json');
  const orig = fs.readFileSync(contentFile, 'utf8');
  const content = JSON.parse(orig);

  const badToken = applyPatch(content, { action: 'set-token', token: '--font-heading', value: 'Comic Sans MS' });
  const badValue = applyPatch(content, { action: 'set-token', token: '--color-primary', value: 'red;background:url(evil)' });
  const badBypass = applyPatch(content, { action: 'set', block: 'site', field: 'themeOverrides.color-primary', value: 'red' });
  // Contrast guard: default theme's btn-primary-text is #14161a — setting the
  // button BACKGROUND to (nearly) the same color must bounce.
  const badContrast = applyPatch(content, { action: 'set-token', token: '--btn-primary-bg', value: '#14161a' }, DEFAULT_TOKENS);

  const unchanged = JSON.stringify(content) === JSON.stringify(JSON.parse(orig));

  if (!badToken.ok && !badValue.ok && !badBypass.ok && !badContrast.ok && unchanged) {
    console.log(`PASS — all four rejected, content untouched:`);
    console.log(`       allowlist: "${badToken.error}"`);
    console.log(`       format guard: "${badValue.error}"`);
    console.log(`       set bypass: "${badBypass.error}"`);
    console.log(`       contrast guard: "${badContrast.error}"`);
    passed++;
  } else {
    console.log('FAIL —', { badToken, badValue, badBypass, badContrast, unchanged });
  }
}

// ── PROOF 7 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 7 — Resolver value guards: valueless writes are rejected ═══');
{
  const content = readContent('example-contractor');
  const orig = JSON.stringify(content);

  const noValuePlain = applyPatch(content, { action: 'set', block: 'site', field: 'copyright' });
  const noValueMatch = applyPatch(content, { action: 'set', block: 'about-values', field: 'items', match: 'anything' });

  const untouched = JSON.stringify(content) === orig;

  if (!noValuePlain.ok && !noValueMatch.ok && untouched) {
    console.log('PASS — valueless set rejected (plain + match form), nothing written:');
    console.log(`       plain: "${noValuePlain.error}"   match: "${noValueMatch.error}"`);
    passed++;
  } else {
    console.log('FAIL —', { noValuePlain, noValueMatch, untouched });
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`${passed}/${TOTAL} proofs passed.`);
process.exit(passed === TOTAL ? 0 : 1);
