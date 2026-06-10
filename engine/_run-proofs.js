#!/usr/bin/env node
'use strict';
// Runs all seven end-to-end proofs in sequence and prints results.
// Proofs 1–4: the original patch/rebuild/rollback path.
//   Proof 1 also guards the v4 annotated preview build: live HTML carries no
//   ids and no data-bk-* attributes; an annotated build carries a data-bk
//   annotation for every editable field the edit map reports.
// Proofs 5–6: the v2 token-editing path (allowlist + format + contrast guards).
// Proof 7:    resolver value guards — valueless writes are rejected.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyPatch } = require('./lib/patch');
const { buildEditMap } = require('./lib/sitemap');

const ROOT = path.resolve(__dirname, '..');

function readContent(client) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'clients', client, 'content.json'), 'utf8'));
}
function writeContent(client, obj) {
  fs.writeFileSync(path.join(ROOT, 'clients', client, 'content.json'),
    JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function build(client, extra = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build.js'), client, ...extra],
    { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}
function loadTokens(content) {
  const theme = (content.site && content.site.theme) || 'default';
  const p = path.join(ROOT, 'themes', theme, 'tokens.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
function pageFile(slug) { return slug === 'index' ? 'index.html' : `${slug}.html`; }
const triKey = (block, item, field, index) =>
  [block || '', item || '', field || '', index == null ? '' : String(index)].join('|');

// Extract every (block, item?, field, index?) annotation present in an
// annotated build's HTML by scanning opening tags that carry data-bk-block.
function presentAnnotations(html) {
  const set = new Set();
  const tagRe = /<[a-zA-Z][^>]*\sdata-bk-block=[^>]*>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const g = (re) => (tag.match(re) || [])[1];
    set.add(triKey(
      g(/\sdata-bk-block="([^"]*)"/),
      g(/\sdata-bk-item="([^"]*)"/),
      g(/\sdata-bk-field="([^"]*)"/),
      g(/\sdata-bk-index="([^"]*)"/),
    ));
  }
  return set;
}

// From a client's edit map, compute (per page file) the REQUIRED annotation
// set — the per-element click-to-edit surface the proof enforces in full —
// and the ALLOWED set — every field the map reports, used for the reverse
// "no annotation is invalid" check. See engine/lib/annotate.js for the scope
// rationale (site config + dotted object-leaf scalars are gated but not
// required, because they have no dedicated clickable element).
function annotationSets(content, tokens) {
  const map = buildEditMap(content, tokens);
  const required = new Map();   // pageFile -> Set(keys)
  const allowed  = new Map();
  const siteKeys = (map.site || []).map(s => triKey('site', null, s.field, null));
  for (const page of map.pages || []) {
    const file = pageFile(page.slug);
    const req = new Set();
    const allow = new Set(siteKeys);            // footer (site fields) on every page
    for (const b of page.blocks || []) {
      for (const s of b.scalars || []) {
        allow.add(triKey(b.id, null, s.field, null));
        if (!s.field.includes('.')) req.add(triKey(b.id, null, s.field, null)); // non-dotted scalars required
      }
      for (const tl of b.textLists || []) {
        (tl.lines || []).forEach((_, i) => {
          const k = triKey(b.id, null, tl.field, i);
          allow.add(k); req.add(k);
        });
      }
      for (const is of b.itemSets || []) {
        for (const it of is.items || []) {
          for (const f of it.fields || []) {
            const k = triKey(b.id, it.id, f, null);
            allow.add(k); req.add(k);
          }
        }
      }
    }
    // Lock in the footer (site) annotation path without over-constraining:
    // every client's map carries copyright, and it is annotated in footer.js.
    if (map.site.some(s => s.field === 'copyright')) req.add(triKey('site', null, 'copyright', null));
    required.set(file, req);
    allowed.set(file, allow);
  }
  return { required, allowed };
}

let passed = 0;
const TOTAL = 7;
const DEFAULT_TOKENS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'themes', 'default', 'tokens.json'), 'utf8'));

// ── PROOF 1 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 1 — Live build hides ids & annotations; annotated build covers every editable field ═══');
{
  const CLIENTS = ['example-contractor', 'example-league', 'example-restaurant'];
  for (const c of CLIENTS) { build(c); build(c, ['--annotate']); }

  const failures = [];

  // (a) LIVE builds: no item ids, no data-bk-* anywhere.
  const idPatterns = [
    'card-renovations', 'testi-edmonton', 'album-deck', 'card-garden',
    'plan-bruschetta', 'faq-reservations', 'row-monday', 'stat-years', 'member-chef'
  ];
  for (const c of CLIENTS) {
    const dir = path.join(ROOT, 'dist', c);
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const leaked = idPatterns.filter(p => html.includes(p));
      if (leaked.length) failures.push(`live ${c}/${f}: id leak ${leaked.join(', ')}`);
      if (html.includes('data-bk-')) failures.push(`live ${c}/${f}: contains data-bk-* (must be annotated build only)`);
    }
  }

  // (b) ANNOTATED builds: every editable field the edit map reports is stamped
  //     (forward coverage), and no annotation is invalid (reverse check).
  let requiredCount = 0;
  for (const c of CLIENTS) {
    const content = readContent(c);
    const { required, allowed } = annotationSets(content, loadTokens(content));
    const dir = path.join(ROOT, 'dist', c + '__annotated');
    for (const [file, reqSet] of required) {
      const html = fs.readFileSync(path.join(dir, file), 'utf8');
      const present = presentAnnotations(html);
      const allow = allowed.get(file);
      requiredCount += reqSet.size;
      for (const k of reqSet) if (!present.has(k)) failures.push(`annotated ${c}/${file}: MISSING annotation ${k}`);
      for (const k of present) if (!allow.has(k)) failures.push(`annotated ${c}/${file}: INVALID annotation ${k} (not in edit map)`);
    }
  }

  if (failures.length === 0) {
    console.log('PASS — live HTML carries no ids and no data-bk-*; annotated builds stamp every');
    console.log(`       editable field the edit map reports (${requiredCount} required annotations across`);
    console.log(`       ${CLIENTS.length} clients) and stamp nothing the map does not report.`);
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.slice(0, 25).forEach(f => console.log(`       ✗ ${f}`));
  }
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
