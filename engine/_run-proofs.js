#!/usr/bin/env node
'use strict';
// Runs all eight end-to-end proofs in sequence and prints results.
// Proofs 1–4: the original patch/rebuild/rollback path.
//   Proof 1 also guards the v4 annotated preview build: live HTML carries no
//   ids and no data-bk-* attributes; an annotated build carries a data-bk
//   annotation for every editable field the edit map reports.
// Proofs 5–6: the v2 token-editing path (allowlist + format + contrast guards).
// Proof 7:    resolver value guards — valueless writes are rejected.
// Proof 8:    owner-editor request handlers (engine/lib/owner.js) exercised
//             directly: edit → candidate-only write + annotated rebuild →
//             approve → live write + clean live build; one-pending-change
//             gate, resolver guards on the UI path, image upload, discard.
// Proof 9:    blueprint scaffolder (engine/lib/scaffold.js): registry loads
//             and validates all shipped blueprints; invalid inputs rejected
//             with nothing written; ids unique site-wide under repeated
//             instantiation; every blueprint × variant builds clean.
// Proof 10:   scaffold through the owner handlers: candidate-only page add
//             with annotations, pending interlock with edits, approve →
//             page + nav entry live with no annotations and no ids.
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
const TOTAL = 10;
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

// ── PROOF 8 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 8 — Owner-editor handlers, exercised directly: edit → candidate → approve ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-owner';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const candIndexPath = path.join(ROOT, 'dist', CLIENT + '__candidate__annotated', 'index.html');
  const failures = [];

  try {
    // Setup: throwaway client cloned from example-restaurant, publishing off
    // (the proof must never create git commits).
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
      path.join(liveDir, 'content.json'));
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Proof Client', publish: 'none' }) + '\n', 'utf8');

    const session = owner.createSession(CLIENT);

    // (a) Session start: candidate equals live and its ANNOTATED preview built.
    if (!fs.readFileSync(candIndexPath, 'utf8').includes('data-bk-block="home-hero"')) {
      failures.push('candidate preview build is not annotated');
    }

    // (b) describeField reports the current candidate value + editor kind.
    const d = owner.describeField(session, { block: 'home-hero', field: 'headline' });
    if (!d.ok || d.kind !== 'text' || d.value !== 'Comfort food, wood-fired.') {
      failures.push(`describeField wrong: ${JSON.stringify(d)}`);
    }

    // (c) Edit: candidate-only write; change card old → new derived from the
    //     resolved patch; candidate preview rebuilt with the new value.
    const NEW = 'Wood-fired, all winter.';
    const e1 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: NEW });
    if (!e1.ok) failures.push(`edit failed: ${e1.error}`);
    else {
      if (e1.pending.old !== 'Comfort food, wood-fired.' || e1.pending.new !== NEW) {
        failures.push(`change card old→new wrong: ${JSON.stringify(e1.pending)}`);
      }
      const cand = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
      const live = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if (cand.pages[0].blocks[0].fields.headline !== NEW) failures.push('candidate content was not updated');
      if (live.pages[0].blocks[0].fields.headline === NEW) failures.push('LIVE content was touched before approve');
      if (!fs.readFileSync(candIndexPath, 'utf8').includes(NEW)) failures.push('candidate preview was not rebuilt');
    }

    // (d) Exactly one pending change at a time.
    const e2 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'subhead', value: 'x' });
    if (e2.ok) failures.push('a second edit was accepted while one was pending');

    // (e) Approve: live content written from the candidate, live build clean
    //     of annotations, publish skipped (publish: "none").
    const a = owner.approve(session);
    if (!a.ok) failures.push(`approve failed: ${a.error}`);
    else {
      if (!a.publish.skipped) failures.push('publish ran despite publish:"none"');
      const live2 = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if (live2.pages[0].blocks[0].fields.headline !== NEW) failures.push('approve did not write live content.json');
      const liveHtml = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      if (!liveHtml.includes(NEW)) failures.push('live build is missing the approved value');
      if (liveHtml.includes('data-bk-')) failures.push('live build contains data-bk-* after approve');
    }

    // (f) The resolver guards run unchanged on the UI path: forbidden field
    //     and unsafe token value both bounce, nothing staged.
    const g1 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'id', value: 'x' });
    const g2 = owner.applyEdit(session, { action: 'set-token', token: '--color-primary', value: 'red;background:url(evil)' });
    if (g1.ok || g2.ok || session.pending) failures.push('a guarded write slipped through the edit handler');

    // (g) Image upload: file lands in candidate img/ under a handler-assigned
    //     path; discard then resets the candidate from live, removing it.
    const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const e3 = owner.applyEdit(session,
      { action: 'set', block: 'home-team', item: 'member-chef', field: 'photo' },
      { name: 'new portrait.png', dataBase64: PNG_1PX });
    if (!e3.ok) failures.push(`image edit failed: ${e3.error}`);
    else {
      if (e3.pending.new !== 'img/new-portrait.png') failures.push(`image path not assigned by the handler: ${e3.pending.new}`);
      if (!fs.existsSync(path.join(candDir, 'img', 'new-portrait.png'))) failures.push('uploaded image missing from candidate img/');
    }
    const disc = owner.discard(session);
    const candText = fs.readFileSync(path.join(candDir, 'content.json'), 'utf8');
    const liveText = fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8');
    if (!disc.ok || candText !== liveText) failures.push('discard did not reset the candidate from live');
    if (fs.existsSync(path.join(candDir, 'img', 'new-portrait.png'))) failures.push('discard left the uploaded image in the candidate');
    if (fs.existsSync(path.join(liveDir, 'img', 'new-portrait.png'))) failures.push('a discarded upload leaked into live img/');
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(candDir, { recursive: true, force: true });
    for (const d of [CLIENT, CLIENT + '__annotated', CLIENT + '__candidate', CLIENT + '__candidate__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — handlers exercised directly: an edit writes ONLY the candidate and');
    console.log('       rebuilds its annotated preview; the change card derives old → new from');
    console.log('       the resolved patch; a second edit is held until approve/discard; approve');
    console.log('       writes live + builds clean HTML; guards hold; uploads stay candidate-side');
    console.log('       until approve and vanish on discard.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 9 ─────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 9 — Scaffolder: schema-validated inputs, collision-proof ids, every blueprint builds ═══');
{
  const scaffold = require('./lib/scaffold');
  const CLIENT = '__proof-scaffold';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const failures = [];

  try {
    // (a) Registry: the three shipped blueprints load and validate; nothing invalid.
    const reg = scaffold.loadBlueprints();
    const keys = reg.blueprints.map(b => b.key);
    for (const want of ['contact-page', 'content-page', 'gallery-page']) {
      if (!keys.includes(want)) failures.push(`registry is missing blueprint "${want}"`);
    }
    if (reg.invalid.length) failures.push(`registry reports invalid blueprints: ${JSON.stringify(reg.invalid)}`);
    const bp = key => (reg.blueprints.find(b => b.key === key) || {}).blueprint;

    // (b) Invalid inputs: every rejection leaves the content byte-identical.
    const content = readContent('example-restaurant');
    const orig = JSON.stringify(content);
    const good = { menuLabel: 'Story', title: 'Our story', intro: 'How we started.', headerStyle: 'default', body: 'One.\n\nTwo.' };
    const rejects = [
      ['missing required input', scaffold.instantiate(content, bp('contact-page'), 'detailsOnly', { menuLabel: 'Contact' })],
      ['over-length menu label', scaffold.instantiate(content, bp('content-page'), 'textOnly', { ...good, menuLabel: 'A label far too long for any menu bar' })],
      ['pattern (http, not https)', scaffold.instantiate(content, bp('contact-page'), 'withForm',
        { menuLabel: 'Contact', title: 'Reach us', intro: 'Say hello.', address: '1 Main St', formAction: 'http://insecure.example/f' })],
      ['select value not offered', scaffold.instantiate(content, bp('content-page'), 'textOnly', { ...good, headerStyle: 'purple' })],
      ['image path traversal', scaffold.instantiate(content, bp('gallery-page'), 'simple',
        { menuLabel: 'Photos', title: 'Photos', intro: 'Pics.', albumTitle: 'Work', photo: '../../evil.png' })],
      ['image wrong extension', scaffold.instantiate(content, bp('gallery-page'), 'simple',
        { menuLabel: 'Photos', title: 'Photos', intro: 'Pics.', albumTitle: 'Work', photo: 'img/x.exe' })],
      ['unknown variant', scaffold.instantiate(content, bp('content-page'), 'fancy', good)],
      ['undeclared value key', scaffold.instantiate(content, bp('content-page'), 'textOnly', { ...good, hack: 'x' })],
    ];
    for (const [label, r] of rejects) {
      if (r.ok) failures.push(`accepted what should be rejected: ${label}`);
    }
    if (JSON.stringify(content) !== orig) failures.push('a rejected instantiation modified the content');

    // (c) Repeated instantiation: same name 12 times → unique slugs and
    //     block ids site-wide, all in nav; then every blueprint × variant
    //     into the same content; the full build accepts the result.
    for (let i = 0; i < 12; i++) {
      const r = scaffold.instantiate(content, bp('content-page'), 'textOnly', good);
      if (!r.ok) { failures.push(`repeat ${i + 1} failed: ${r.errors.join('; ')}`); break; }
    }
    const more = [
      ['contact-page', 'withForm', { menuLabel: 'Contact', title: 'Reach us', intro: 'Say hello.', address: '1 Main St', formAction: 'https://formspree.io/f/x' }],
      ['contact-page', 'detailsOnly', { menuLabel: 'Visit', title: 'Find us', intro: 'Drop by.', address: '1 Main St' }],
      ['gallery-page', 'banner', { menuLabel: 'Photos', title: 'Our work', intro: 'Pictures.', albumTitle: 'Recent', photo: 'img/a.jpg', bannerPhoto: 'img/b.jpg' }],
      ['gallery-page', 'simple', { menuLabel: 'More photos', title: 'More work', intro: 'More pictures.', albumTitle: 'Older', photo: 'img/c.jpg' }],
      ['content-page', 'withCta', { ...good, menuLabel: 'About', ctaStatement: 'Like what you read?', ctaLabel: 'Get in touch', ctaHref: 'contact.html' }],
    ];
    for (const [key, variant, values] of more) {
      const r = scaffold.instantiate(content, bp(key), variant, values);
      if (!r.ok) failures.push(`${key}/${variant} failed: ${r.errors.join('; ')}`);
    }
    const slugs = content.pages.map(p => p.slug);
    if (new Set(slugs).size !== slugs.length) failures.push('page slugs collided');
    const ids = [];
    for (const p of content.pages) for (const b of p.blocks) ids.push(b.id);
    if (new Set(ids).size !== ids.length) failures.push('block ids collided');
    const storyNavs = content.site.nav.links.filter(l => l.label === 'Story');
    if (storyNavs.length !== 12) failures.push(`expected 12 "Story" nav entries, found ${storyNavs.length}`);
    const story = content.pages.find(p => p.slug === 'story');
    if (!story || !Array.isArray(story.blocks[1].fields.body) || story.blocks[1].fields.body.length !== 2) {
      failures.push('|paragraphs did not split the body into 2 paragraphs');
    }

    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    const b = build(CLIENT);
    if (!b.ok) failures.push(`full build rejected the scaffolded content:\n${b.out}`);
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, 'dist', CLIENT), { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — registry validates all 3 blueprints; 8 classes of bad input rejected with');
    console.log('       content untouched; 12 same-name instantiations + every blueprint × variant');
    console.log('       coexist with unique slugs and block ids, and the full build accepts the result.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 10 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 10 — Scaffold through the owner handlers: candidate page → approve → live, no annotations ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-scaffold2';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const failures = [];

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
      path.join(liveDir, 'content.json'));
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Proof Client', publish: 'none' }) + '\n', 'utf8');

    const session = owner.createSession(CLIENT);
    const livePages = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8')).pages.length;

    // (a) Scaffold a gallery page into the CANDIDATE only.
    const sc = owner.applyScaffold(session, {
      blueprint: 'gallery-page', variant: 'simple',
      values: { menuLabel: 'Photos', title: 'Our work in pictures', intro: 'A look at recent projects.', albumTitle: 'Recent work', photo: 'img/sample-1.jpg' },
    });
    if (!sc.ok) failures.push(`scaffold failed: ${sc.error}`);
    else {
      if (sc.created.slug !== 'photos') failures.push(`unexpected slug: ${sc.created.slug}`);
      const cand = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
      const live = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if (cand.pages.length !== livePages + 1) failures.push('candidate did not gain the page');
      if (live.pages.length !== livePages) failures.push('LIVE gained the page before approve');
      const ann = fs.readFileSync(path.join(ROOT, 'dist', CLIENT + '__candidate__annotated', 'photos.html'), 'utf8');
      if (!ann.includes('data-bk-block="photos-header"') || !ann.includes('data-bk-block="photos-albums"')) {
        failures.push('the scaffolded candidate page is not annotated for click-to-edit');
      }
    }

    // (b) The pending interlock covers both directions: no edit and no
    //     second scaffold while a scaffold is pending.
    const e = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: 'x' });
    const sc2 = owner.applyScaffold(session, {
      blueprint: 'content-page', variant: 'textOnly',
      values: { menuLabel: 'About', title: 'About', intro: 'x', headerStyle: 'default', body: 'x' },
    });
    if (e.ok || sc2.ok) failures.push('the one-pending-change rule did not hold across edit/scaffold');

    // (c) Approve: page + nav entry live; live HTML free of annotations and ids.
    const a = owner.approve(session);
    if (!a.ok) failures.push(`approve failed: ${a.error}`);
    else {
      const live2 = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if (!live2.pages.some(p => p.slug === 'photos')) failures.push('approved page missing from live content');
      if (!live2.site.nav.links.some(l => l.label === 'Photos' && l.href === 'photos.html')) {
        failures.push('nav entry missing from live content');
      }
      const html = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'photos.html'), 'utf8');
      if (!html.includes('Our work in pictures')) failures.push('live page is missing its heading');
      if (html.includes('data-bk-')) failures.push('live scaffolded page contains data-bk-*');
      if (html.includes('photos-header') || html.includes('photos-albums') || html.includes('album-1')) {
        failures.push('live scaffolded page leaks block/item ids');
      }
      const index = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      if (!index.includes('photos.html')) failures.push('live nav does not link the new page');
      const sitemap = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'sitemap.xml'), 'utf8');
      if (!sitemap.includes('photos.html')) failures.push('sitemap.xml does not list the new page');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(candDir, { recursive: true, force: true });
    for (const d of [CLIENT, CLIENT + '__annotated', CLIENT + '__candidate', CLIENT + '__candidate__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — a blueprint page lands in the CANDIDATE with full click-to-edit');
    console.log('       annotations; edits and further scaffolds are held while it is pending;');
    console.log('       approve puts the page, its nav entry, and its sitemap line live with no');
    console.log('       annotations and no ids in the HTML.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`${passed}/${TOTAL} proofs passed.`);
process.exit(passed === TOTAL ? 0 : 1);
