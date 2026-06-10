#!/usr/bin/env node
'use strict';
// Runs all eight end-to-end proofs in sequence and prints results.
// Proofs 1–4: the original patch/rebuild/rollback path.
// Proofs 5–6: the v2 token-editing path (allowlist + format + contrast guards).
// Proof 7:    the v3 deterministic repair pass.
// Proof 8:    the v3.1 hardening — value guards, set-token→refuse downgrade,
//             discriminated patch schema, and triage narrowing.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyPatch } = require('./lib/patch');
const { repairPatch } = require('./lib/repair');
const { buildPatchSchema } = require('./lib/patch-schema');
const { triageRequest } = require('./lib/triage');

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
const TOTAL = 8;
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
console.log('\n═══ PROOF 7 — Repair pass fixes known near-misses, never invents targets ═══');
{
  const content = readContent('example-contractor');

  // (a) The exact shape gemma3:4b produced on every client: field name in "block".
  const nearMiss = { action: 'set', block: 'copyright', field: 'value', value: '© 2027 Example Contracting. All rights reserved.' };
  const fixed = repairPatch(content, nearMiss);
  const rA = applyPatch(content, fixed.patch, DEFAULT_TOKENS);
  const aOk = rA.ok && content.site.copyright === nearMiss.value
    && fixed.patch.block === 'site' && fixed.patch.field === 'copyright';

  // (b) A patch that names something that does NOT exist must come back
  // untouched and still be rejected — repair never invents targets.
  const content2 = readContent('example-contractor');
  const nonsense = { action: 'set', block: 'blog-page', field: 'title', value: 'x' };
  const fixed2 = repairPatch(content2, nonsense);
  const rB = applyPatch(content2, fixed2.patch, DEFAULT_TOKENS);
  const bOk = !rB.ok && fixed2.repairs.length === 0
    && JSON.stringify(content2) === JSON.stringify(readContent('example-contractor'));

  if (aOk && bOk) {
    console.log('PASS — near-miss {block:"copyright",field:"value"} repaired to');
    console.log(`       {block:"site",field:"copyright"} and applied (${fixed.repairs.join('; ')});`);
    console.log(`       nonsense target untouched and rejected: "${rB.error}". (in-memory only)`);
    passed++;
  } else {
    console.log('FAIL —', { aOk, bOk, fixed, rA, fixed2, rB });
  }
}

// ── PROOF 8 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 8 — v3.1 hardening: value guards, downgrades, repairs, triage ═══');
{
  const content = readContent('example-contractor');
  const orig = JSON.stringify(content);

  // (a) Valueless writes must be rejected — both plain set and the match form.
  const noValuePlain = applyPatch(content, { action: 'set', block: 'site', field: 'copyright' });
  const noValueMatch = applyPatch(content, { action: 'set', block: 'about-values', field: 'items', match: 'anything' });

  // (b) Half-formed set-token (no value) downgrades to an explicit refusal.
  const rep = repairPatch(content, {
    action: 'set-token', token: '--color-primary',
    reason: 'Text colors are not editable; refer to the developer.'
  });
  const downgraded = rep.patch.action === 'refuse'
    && typeof rep.patch.reason === 'string' && rep.patch.reason.includes('not editable')
    && !('token' in rep.patch);

  // (c) New near-miss family from live 4b runs: item id embedded in the
  //     dotted field path, plus an empty "match". Repaired and applied;
  //     a nonsense id must come back untouched and rejected.
  const c2 = readContent('example-contractor');
  const rep2 = repairPatch(c2, {
    action: 'set', block: 'home-services',
    field: 'cards.card-renovations.body', match: '', value: 'Proof-8 reworded body.'
  });
  const r2 = applyPatch(c2, rep2.patch, DEFAULT_TOKENS);
  const itemRepairOk = rep2.patch.item === 'card-renovations'
    && rep2.patch.field === 'body' && !('match' in rep2.patch) && r2.ok;
  const c3 = readContent('example-contractor');
  const rep3 = repairPatch(c3, {
    action: 'set', block: 'home-services',
    field: 'cards.card-nonexistent.body', value: 'x'
  });
  const r3 = applyPatch(c3, rep3.patch, DEFAULT_TOKENS);
  const noInventOk = rep3.repairs.length === 0 && !r3.ok;

  // (d) Discriminated schema + triage: set-token branch requires token AND
  //     value; hard-stop vocabulary narrows to refuse-only; TEXT-side color
  //     requests narrow to refuse-only (pair-exclusion); brand-color
  //     requests keep set-token + refuse and nothing else.
  const full = buildPatchSchema(content);
  const tokBranch = (full.anyOf || []).find(b => b.properties.action.enum[0] === 'set-token');
  const schemaOk = !!tokBranch
    && tokBranch.required.includes('token') && tokBranch.required.includes('value')
    && tokBranch.additionalProperties === false;

  const acts = q => (buildPatchSchema(content, triageRequest(q).allowedActions).anyOf || [])
    .map(b => b.properties.action.enum[0]).sort().join(',');
  const triageOk = acts('Make the first heading bold and red.') === 'refuse'
    && acts('Change the body text color to white.') === 'refuse'
    && acts('Make the menu prices red.') === 'refuse'
    && acts('We rebranded — change our main brand color to green, #2D6A4F.') === 'refuse,set-token';

  const untouched = JSON.stringify(content) === orig;

  if (!noValuePlain.ok && !noValueMatch.ok && downgraded
    && itemRepairOk && noInventOk && schemaOk && triageOk && untouched) {
    console.log('PASS — valueless set rejected (plain + match form), nothing written:');
    console.log(`       plain: "${noValuePlain.error}"   match: "${noValueMatch.error}"`);
    console.log(`       valueless set-token downgraded to refuse (${rep.repairs.join('; ')});`);
    console.log(`       item-in-field path repaired and applied (${rep2.repairs.join('; ')});`);
    console.log(`       nonsense id untouched and rejected: "${r3.error}";`);
    console.log('       schema requires token+value; triage: hard-stop and text-color →');
    console.log('       refuse-only, brand color → set-token + refuse. (in-memory only)');
    passed++;
  } else {
    console.log('FAIL —', {
      noValuePlain, noValueMatch, downgraded,
      itemRepairOk, noInventOk, schemaOk, triageOk, untouched
    });
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`${passed}/${TOTAL} proofs passed.`);
process.exit(passed === TOTAL ? 0 : 1);
