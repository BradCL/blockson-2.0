#!/usr/bin/env node
'use strict';
// Runs all fifteen end-to-end proofs in sequence and prints results.
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
// Proof 11:   blueprint authoring kit (engine/lib/bpcheck.js + the
//             validate-blueprint / blueprints-check CLIs): every shipped
//             blueprint passes the acceptance pipeline; the committed demo
//             gallery client matches deterministic regeneration (stale =
//             fail); the live gallery build is annotation/id free; a
//             known-bad blueprint fails the CLI with named reasons.
// Proof 12:   theme validator (engine/lib/themecheck.js + validate-theme
//             CLI): every shipped theme passes (tokens, value safety, hard
//             rules, contrast pairs, demo-client coverage build); the demo
//             corpus covers the whole block registry; a known-bad theme
//             fails with each reason named.
// Proof 13:   editor server request guards over real HTTP (engine/serve.js):
//             foreign Host header refused, header-less POST refused, encoded
//             path traversal confined, nosniff + SAMEORIGIN on responses.
// Proof 14:   build-time image weight advisory (engine/build.js): a >500 KB
//             file in img/ is named on stderr with its size, a >2 MB folder
//             gets a one-line total, and the build still succeeds (exit 0).
// Proof 15:   contact-form delivery modes: endpoint-mode output is the old
//             output plus exactly the honeypot line (and the honeypot never
//             carries an annotation); netlify mode emits the Netlify form
//             attributes and makes formAction optional in the schema while
//             the https:// guard holds everywhere else; the documented
//             https://UNCONFIGURED placeholder warns at build without
//             failing it.
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
const TOTAL = 15;
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

    // (h) Upload signature guard: the bytes must BE the image type the name
    //     claims — an HTML payload named .png is rejected with nothing staged
    //     and nothing written.
    const fake = owner.applyEdit(session,
      { action: 'set', block: 'home-team', item: 'member-chef', field: 'photo' },
      { name: 'payload.png', dataBase64: Buffer.from('<html><script>x()</script></html>').toString('base64') });
    if (fake.ok || session.pending) failures.push('a non-image upload was accepted under an image name');
    if (fs.existsSync(path.join(candDir, 'img', 'payload.png'))) failures.push('a rejected upload left a file in candidate img/');
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
    console.log('       until approve and vanish on discard; non-image bytes under an image');
    console.log('       name are refused by the signature guard.');
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

// ── PROOF 11 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 11 — Authoring kit: every blueprint validates, the demo gallery is fresh, a bad blueprint fails with reasons ═══');
{
  const bpcheck = require('./lib/bpcheck');
  const failures = [];
  const galleryFile = path.join(ROOT, 'clients', bpcheck.GALLERY_CLIENT, 'content.json');
  const badFile = path.join(ROOT, 'dist', '__proof-bad-blueprint.json');
  const evilHrefFile = path.join(ROOT, 'dist', '__proof-evil-href-blueprint.json');

  const runNode = (args) => {
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    return { status: r.status, out: ((r.stdout || '') + (r.stderr || '')) };
  };

  try {
    // (a) The whole registry passes the acceptance pipeline AND the demo
    //     gallery regenerates byte-identically to the committed file —
    //     a contributor who adds/changes a blueprint without rerunning
    //     `npm run blueprints:check` (and committing) fails here.
    const before = fs.existsSync(galleryFile) ? fs.readFileSync(galleryFile, 'utf8') : null;
    const check = runNode(['engine/blueprints-check.js']);
    if (check.status !== 0) failures.push(`blueprints:check exited ${check.status}:\n${check.out.slice(-1500)}`);
    const after = fs.readFileSync(galleryFile, 'utf8');
    if (before === null) failures.push('clients/blueprint-gallery/content.json was not committed');
    else if (before !== after) {
      failures.push('demo gallery is STALE — run `npm run blueprints:check` and commit clients/blueprint-gallery/content.json');
    }

    // (b) The gallery is the regression corpus: one page per blueprint ×
    //     variant, plus index, all built live with no annotations and no
    //     id attributes for the created blocks.
    const demo = bpcheck.demoContent();
    if (!demo.ok) failures.push(`demoContent failed: ${demo.errors.join('; ')}`);
    else {
      if (JSON.stringify(demo.content, null, 2) + '\n' !== after) {
        failures.push('regenerated gallery content does not match the file blueprints:check wrote');
      }
      const distDir = path.join(ROOT, 'dist', bpcheck.GALLERY_CLIENT);
      for (const c of demo.created) {
        const p = path.join(distDir, c.file);
        if (!fs.existsSync(p)) { failures.push(`gallery build is missing ${c.file} (${c.blueprint}/${c.variant})`); continue; }
        const html = fs.readFileSync(p, 'utf8');
        if (html.includes('data-bk-')) failures.push(`live gallery ${c.file} contains data-bk-*`);
        for (const id of c.blockIds) {
          if (html.includes(`id="${id}"`)) failures.push(`live gallery ${c.file} leaks block id "${id}"`);
        }
      }
      const reg = require('./lib/scaffold').loadBlueprints();
      const variantCount = reg.blueprints.reduce((n, b) => n + b.blueprint.variants.length, 0);
      if (demo.created.length !== variantCount) {
        failures.push(`gallery has ${demo.created.length} instantiations, expected ${variantCount} (every blueprint × variant)`);
      }
    }

    // (c) The single-file CLI passes a shipped blueprint…
    const good = runNode(['engine/validate-blueprint.js', path.join('blueprints', 'contact-page.json')]);
    if (good.status !== 0) failures.push(`validate-blueprint rejected a shipped blueprint:\n${good.out.slice(-800)}`);

    // (d) …and fails a known-bad one (unknown block type, undeclared
    //     placeholder, unknown key) with each reason NAMED. The bad file
    //     lives under dist/ — never inside the scanned blueprints/ dir.
    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    fs.writeFileSync(badFile, JSON.stringify({
      name: 'Bad blueprint', purpose: 'Must fail the validator', kind: 'page', surprise: true,
      variants: [{ key: 'only', label: 'Only layout' }],
      inputs: [{ key: 'title', label: 'Title', type: 'text', required: true }],
      template: { only: {
        navLabel: '{{title}}',
        meta: { title: '{{title}}', description: 'x' },
        blocks: [{ id: 'main', type: 'carousel', fields: { heading: '{{title}}', oops: '{{undeclared}}' } }],
      } },
    }, null, 2), 'utf8');
    const bad = runNode(['engine/validate-blueprint.js', badFile]);
    if (bad.status === 0) failures.push('validate-blueprint PASSED a known-bad blueprint');
    for (const named of ['unknown block type "carousel"', 'unknown key "surprise"', '{{undeclared}}']) {
      if (!bad.out.includes(named)) failures.push(`bad-blueprint output does not name the reason: ${named}`);
    }

    // (e) A structurally valid blueprint smuggling a javascript: link must
    //     fail at the build gate (the content schema's safeHref guard): a
    //     scheme the renderer would print into an href is a stored-XSS
    //     vector that no visual check of the demo gallery could catch.
    fs.writeFileSync(evilHrefFile, JSON.stringify({
      name: 'Sneaky link blueprint', purpose: 'Must fail the build gate', kind: 'page',
      variants: [{ key: 'only', label: 'Only layout' }],
      inputs: [{ key: 'title', label: 'Title', type: 'text', required: true }],
      template: { only: {
        navLabel: '{{title}}',
        meta: { title: '{{title}}', description: 'x' },
        blocks: [{ id: 'main', type: 'cta', fields: {
          statement: '{{title}}',
          button: { label: 'Click me', href: 'javascript:alert(1)', style: 'primary' },
        } }],
      } },
    }, null, 2), 'utf8');
    const evil = runNode(['engine/validate-blueprint.js', evilHrefFile]);
    if (evil.status === 0) failures.push('validate-blueprint PASSED a blueprint with a javascript: href');
    if (!/href/.test(evil.out)) failures.push('the javascript:-href rejection does not name the href field');
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(badFile, { force: true });
    fs.rmSync(evilHrefFile, { force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — every shipped blueprint clears the acceptance pipeline (schema → sample');
    console.log('       instantiation → full build → invariant checks); the committed demo gallery');
    console.log('       matches deterministic regeneration and its live build carries no annotations');
    console.log('       or id attributes; a known-bad blueprint fails the CLI with named reasons,');
    console.log('       and a javascript: href is stopped at the build gate.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 12 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 12 — Theme validator: every shipped theme passes; a bad theme fails with named reasons ═══');
{
  const bpcheck = require('./lib/bpcheck');
  const BLOCKS = require('./blocks/_registry');
  const failures = [];
  const badDir = path.join(ROOT, 'dist', '__proof-bad-theme');

  const runNode = (args) => {
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    return { status: r.status, out: ((r.stdout || '') + (r.stderr || '')) };
  };

  try {
    // (a) Every shipped theme clears the full pipeline (tokens, value
    //     safety, hard rules, contrast pairs, demo-client coverage build).
    const themeDirs = fs.readdirSync(path.join(ROOT, 'themes'), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join('themes', d.name));
    const all = runNode([path.join('engine', 'validate-theme.js'), ...themeDirs]);
    if (all.status !== 0) failures.push(`a shipped theme failed validation:\n${all.out.slice(-1500)}`);
    if (!all.out.includes(`${themeDirs.length}/${themeDirs.length} theme(s) passed`)) {
      failures.push(`expected ${themeDirs.length}/${themeDirs.length} themes to pass`);
    }

    // (b) The demo corpus really covers the whole block registry — the
    //     ratchet a Tier B block type must extend.
    const demo = bpcheck.demoContent();
    if (!demo.ok) failures.push(`demoContent failed: ${demo.errors.join('; ')}`);
    else {
      const types = new Set();
      for (const p of demo.content.pages) for (const b of p.blocks) types.add(b.type);
      const uncovered = Object.keys(BLOCKS).filter(t => !types.has(t));
      if (uncovered.length) failures.push(`demo corpus misses block type(s): ${uncovered.join(', ')}`);
    }

    // (c) A known-bad theme — missing tokens, an injection value, external
    //     CSS, @import, a JS file, two contrast collisions — fails with
    //     each reason NAMED. Lives under dist/, outside themes/.
    fs.mkdirSync(path.join(badDir, 'css'), { recursive: true });
    fs.writeFileSync(path.join(badDir, 'tokens.json'), JSON.stringify({
      cssBase: 'default',
      'font-heading': 'sans-serif', 'font-body': 'sans-serif',
      'color-bg': '#ffffff', 'color-surface': '#f5f5f5',
      'color-text': '#111111', 'color-muted': '#cccccc',
      'color-primary': 'red;background:url(evil)', 'color-accent': '#ff0000',
      'btn-primary-bg': '#eeeeee', 'btn-primary-text': '#f0f0f0',
      'nav-bg': '#ffffff', 'nav-text': '#222222',
      'hero-overlay-opacity': '0.5', 'radius': '8px',
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(badDir, 'css', 'styles.css'),
      '@import url(https://fonts.example.com/x.css);\n.hero{color:red}\n', 'utf8');
    fs.writeFileSync(path.join(badDir, 'main.js'), '// themes must not ship JS\n', 'utf8');

    const bad = runNode([path.join('engine', 'validate-theme.js'), path.join('dist', '__proof-bad-theme')]);
    if (bad.status === 0) failures.push('validate-theme PASSED a known-bad theme');
    for (const named of [
      'missing required token "footer-bg"',
      'fails the injection guard',
      'external resource',
      '@import',
      'no JavaScript',
      'contrast: "btn-primary-text"',
      'contrast: "color-muted"',
    ]) {
      if (!bad.out.includes(named)) failures.push(`bad-theme output does not name the reason: ${named}`);
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(badDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — all shipped themes clear the pipeline (token completeness, injection +');
    console.log('       format guards on values, no JS / no external resources, tiered contrast');
    console.log('       pairs, demo-client coverage build of all 21 block types); a known-bad');
    console.log('       theme fails the CLI with every reason named.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 13 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 13 — Editor server request guards, exercised over real HTTP ═══');
{
  // serve.js documents four request guards (loopback-only, Host-header check,
  // editor-header requirement on POST, static-path confinement) plus the
  // defense-in-depth response headers. They are HTTP plumbing, so unlike the
  // owner.js handlers they cannot be proved by direct calls — this proof
  // starts the REAL server (on an OS-assigned port) and probes it with raw
  // requests. The async client lives in a harness script written under dist/
  // (the same pattern as the bad-blueprint/bad-theme artifacts) because this
  // proof runner is deliberately straight-line synchronous.
  const CLIENT  = '__proof-serve';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const harness = path.join(ROOT, 'dist', '__proof-serve-harness.js');
  const failures = [];

  const HARNESS_SRC = [
    "'use strict';",
    "const { spawn } = require('child_process');",
    "const http = require('http');",
    "const path = require('path');",
    "const ROOT = process.argv[2], CLIENT = process.argv[3];",
    "const failures = [];",
    "let port = null, done = false;",
    "const srv = spawn(process.execPath, [path.join(ROOT, 'engine', 'serve.js'), CLIENT, '--port', '0'], { cwd: ROOT });",
    "let out = '';",
    "const giveUp = setTimeout(function () { failures.push('server did not start within 30s: ' + out.slice(-400)); finish(); }, 30000);",
    "srv.stdout.on('data', function (d) {",
    "  out += d;",
    "  const m = out.match(/http:\\/\\/127\\.0\\.0\\.1:(\\d+)\\//);",
    "  if (m && port === null) { port = Number(m[1]); run(); }",
    "});",
    "srv.stderr.on('data', function (d) { out += d; });",
    "srv.on('exit', function () { if (port === null) { failures.push('server exited before listening: ' + out.slice(-400)); finish(); } });",
    "function req(opts, body) {",
    "  return new Promise(function (resolve) {",
    "    const r = http.request(Object.assign({ host: '127.0.0.1', port: port }, opts), function (res) {",
    "      let data = '';",
    "      res.on('data', function (c) { data += c; });",
    "      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: data }); });",
    "    });",
    "    r.on('error', function (e) { resolve({ status: 0, headers: {}, body: 'request error: ' + e.message }); });",
    "    if (body) r.write(body);",
    "    r.end();",
    "  });",
    "}",
    "async function run() {",
    "  try {",
    "    // (a) A local request works, and every response carries the",
    "    //     defense-in-depth headers.",
    "    const home = await req({ path: '/' });",
    "    if (home.status !== 200) failures.push('GET / expected 200, got ' + home.status);",
    "    if (home.headers['x-content-type-options'] !== 'nosniff') failures.push('GET / is missing X-Content-Type-Options: nosniff');",
    "    if (home.headers['x-frame-options'] !== 'SAMEORIGIN') failures.push('GET / is missing X-Frame-Options: SAMEORIGIN');",
    "    const state = await req({ path: '/api/state' });",
    "    if (state.headers['x-content-type-options'] !== 'nosniff') failures.push('API responses are missing nosniff');",
    "    // (b) A loopback request wearing a foreign Host header (DNS-rebinding",
    "    //     shape) is refused.",
    "    const rebind = await req({ path: '/', headers: { Host: 'evil.example.com' } });",
    "    if (rebind.status !== 403) failures.push('foreign Host header expected 403, got ' + rebind.status);",
    "    // (c) A POST without the editor header (what a cross-origin page",
    "    //     could send) is refused; the same POST with the header reaches",
    "    //     the handler (token-check: a guard run, no write).",
    "    const naked = await req({ method: 'POST', path: '/api/token-check', headers: { 'Content-Type': 'application/json' } }, '{}');",
    "    if (naked.status !== 403) failures.push('headerless POST expected 403, got ' + naked.status);",
    "    const armed = await req({ method: 'POST', path: '/api/token-check',",
    "      headers: { 'Content-Type': 'application/json', 'x-blockson-ui': '1' } },",
    "      JSON.stringify({ token: '--color-primary', value: '#2D6A4F' }));",
    "    if (armed.status !== 200) failures.push('editor POST expected 200, got ' + armed.status + ' ' + armed.body.slice(0, 200));",
    "    // (d) Encoded traversal out of the preview/UI roots must not serve",
    "    //     repo files (package.json is the canary).",
    "    const t1 = await req({ path: '/preview/%2e%2e%2fpackage.json' });",
    "    if (t1.status === 200 || t1.body.indexOf('blockson') !== -1) failures.push('encoded ../ escaped the preview root (' + t1.status + ')');",
    "    const t2 = await req({ path: '/preview/..%5C..%5Cpackage.json' });",
    "    if (t2.status === 200 || t2.body.indexOf('blockson') !== -1) failures.push('encoded ..\\\\ escaped the preview root (' + t2.status + ')');",
    "    const t3 = await req({ path: '/ui/%2e%2e%2fserve.js' });",
    "    if (t3.status === 200) failures.push('/ui/ served a file outside its allowlist');",
    "  } catch (e) {",
    "    failures.push('exception: ' + e.message);",
    "  }",
    "  finish();",
    "}",
    "function finish() {",
    "  if (done) return;",
    "  done = true;",
    "  clearTimeout(giveUp);",
    "  try { srv.kill(); } catch (e) {}",
    "  console.log('PROOF13RESULT ' + JSON.stringify({ failures: failures }));",
    "  process.exit(0);",
    "}",
  ].join('\n');

  try {
    // Throwaway client, publishing off — same setup as proof 8.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
      path.join(liveDir, 'content.json'));
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Proof Client', publish: 'none' }) + '\n', 'utf8');

    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    fs.writeFileSync(harness, HARNESS_SRC, 'utf8');
    const r = spawnSync(process.execPath, [harness, ROOT, CLIENT],
      { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    const m = (r.stdout || '').match(/PROOF13RESULT (\{.*\})/);
    if (!m) failures.push(`harness produced no result:\n${((r.stdout || '') + (r.stderr || '')).slice(-1000)}`);
    else failures.push(...JSON.parse(m[1]).failures);
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(harness, { force: true });
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, 'clients', CLIENT + '__candidate'), { recursive: true, force: true });
    for (const d of [CLIENT, CLIENT + '__annotated', CLIENT + '__candidate', CLIENT + '__candidate__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — the real server, probed over HTTP: local requests succeed and carry');
    console.log('       nosniff + SAMEORIGIN headers; a foreign Host header and a header-less');
    console.log('       POST are both refused; encoded path traversal cannot escape the');
    console.log('       preview or UI roots.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 14 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 14 — Image weight advisory: heavy files are named, the build still succeeds ═══');
{
  const CLIENT  = '__proof-imgweight';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const imgDir  = path.join(liveDir, 'img');
  const failures = [];

  try {
    // Throwaway client (oversized files are GENERATED here, never committed).
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(imgDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-contractor', 'content.json'),
      path.join(liveDir, 'content.json'));

    // (a) One 600 KB file: its per-file warning fires, no folder total
    //     (600 KB < 2 MB), and the build exits 0 with its normal output.
    fs.writeFileSync(path.join(imgDir, 'big-photo.jpg'), Buffer.alloc(600 * 1024));
    const b1 = build(CLIENT);
    if (!b1.ok) failures.push(`build with a heavy image failed (the advisory must never fail a build):\n${b1.out}`);
    if (!/img\/big-photo\.jpg is 600 KB/.test(b1.out)) failures.push(`per-file warning missing or wrong: ${b1.out}`);
    if (/img\/ totals/.test(b1.out)) failures.push('folder total fired below the 2 MB threshold');
    if (!/Built \d+ page\(s\)/.test(b1.out)) failures.push('normal build output is missing');

    // (b) Add a 1.6 MB file: both per-file warnings fire plus the folder
    //     total line; small files are never named.
    fs.writeFileSync(path.join(imgDir, 'huge-banner.png'), Buffer.alloc(1600 * 1024));
    fs.writeFileSync(path.join(imgDir, 'small-icon.png'), Buffer.alloc(20 * 1024));
    const b2 = build(CLIENT);
    if (!b2.ok) failures.push(`second build failed:\n${b2.out}`);
    if (!/img\/big-photo\.jpg is 600 KB/.test(b2.out)) failures.push('first per-file warning missing on rebuild');
    if (!/img\/huge-banner\.png is 1\.6 MB/.test(b2.out)) failures.push(`second per-file warning missing or wrong: ${b2.out}`);
    if (!/img\/ totals 2\.2 MB across 3 files/.test(b2.out)) failures.push(`folder total line missing or wrong: ${b2.out}`);
    if (/small-icon/.test(b2.out)) failures.push('a file under the limit was named in a warning');
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, 'dist', CLIENT), { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — a >500 KB image is named on stderr with its size and a one-sentence');
    console.log('       fix, a >2 MB img/ folder gets the one-line total, files under the');
    console.log('       limit are never named, and the build succeeds unchanged either way.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 15 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 15 — contact-form delivery: endpoint unchanged + honeypot, netlify mode, placeholder warning ═══');
{
  const contactForm = require('./blocks/contact-form');
  const { NOOP_BLOCK } = require('./lib/annotate');
  const { validate } = require('./lib/validate');
  const CLIENT  = '__proof-forms';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const failures = [];

  const HP = '<div class="form-hp" aria-hidden="true"><input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></div>';
  const count = (haystack, needle) => haystack.split(needle).length - 1;

  try {
    // (a) Endpoint mode is byte-identical to the pre-change renderer except
    //     the single honeypot line. `oldGolden` is the old module's exact
    //     output for this fixture; the new output must equal it with the
    //     honeypot line spliced in after the subject input — nothing else.
    const fixture = {
      tag: 'Say hello', heading: 'How can we help?',
      formAction: 'https://relay.example/f', subjectLine: 'Website enquiry',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'phone', label: 'Phone', type: 'tel' },
      ],
      submitLabel: 'Go',
    };
    const oldGolden = [
      '<section class="contact-form-section">',
      '  <div class="container">',
      '    <div class="section-tag">Say hello</div>',
      '    <h2>How can we help?</h2>',
      '    <form class="contact-form" method="POST" action="https://relay.example/f">',
      '      <input type="hidden" name="_subject" value="Website enquiry">',
      '      <div class="form-group">',
      '        <label for="field-email">Email <span class="form-required" aria-hidden="true">*</span></label>',
      '        <input type="email" name="email" id="field-email" required>',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="field-phone">Phone <span class="form-optional">(optional)</span></label>',
      '        <input type="tel" name="phone" id="field-phone">',
      '      </div>',
      '      <div class="form-submit">',
      '        <button type="submit" class="btn btn-primary">Go</button>',
      '      </div>',
      '    </form>',
      '  </div>',
      '</section>',
    ];
    const newGolden = oldGolden.slice(0, 6).concat(['      ' + HP], oldGolden.slice(6)).join('\n');
    const endpointHtml = contactForm(fixture, {}, NOOP_BLOCK);
    if (endpointHtml !== newGolden) {
      failures.push('endpoint-mode output is not the old output + exactly the honeypot line');
    }

    // …and on a real example client's live build: same form tag as before,
    // exactly one honeypot, and none of the netlify-mode attributes.
    build('example-contractor');
    const liveHtml = fs.readFileSync(path.join(ROOT, 'dist', 'example-contractor', 'contact.html'), 'utf8');
    if (!liveHtml.includes('<form class="contact-form" method="POST" action="https://formspree.io/f/xxxxxxx">')) {
      failures.push('example-contractor form tag changed in endpoint mode');
    }
    if (count(liveHtml, HP) !== 1) failures.push('example-contractor contact page does not carry exactly one honeypot');
    if (liveHtml.includes('data-netlify') || liveHtml.includes('form-name')) {
      failures.push('netlify attributes leaked into an endpoint-mode build');
    }

    // (b) Netlify mode emits the expected attributes: form name,
    //     data-netlify, netlify-honeypot wiring, the hidden form-name
    //     input, and the success-redirect action only when configured.
    const nf = contactForm({
      delivery: { mode: 'netlify', formName: 'enquiries', successPath: 'thanks.html' },
      fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    }, {}, NOOP_BLOCK);
    if (!nf.includes('<form class="contact-form" method="POST" name="enquiries" data-netlify="true" netlify-honeypot="_gotcha" action="thanks.html">')) {
      failures.push('netlify mode did not emit the expected form attributes');
    }
    if (!nf.includes('<input type="hidden" name="form-name" value="enquiries">')) {
      failures.push('netlify mode is missing the hidden form-name input');
    }
    if (count(nf, HP) !== 1) failures.push('netlify mode does not carry exactly one honeypot');
    const nfDefaults = contactForm({
      delivery: { mode: 'netlify' },
      fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    }, {}, NOOP_BLOCK);
    if (!nfDefaults.includes('name="contact" data-netlify="true" netlify-honeypot="_gotcha">')) {
      failures.push('netlify mode defaults (formName "contact", no action) are wrong');
    }

    // Schema: formAction is optional ONLY under netlify mode; the https://
    // requirement and the no-scheme successPath guard hold everywhere else.
    const base = readContent('example-contractor');
    const formBlock = c => c.pages.flatMap(p => p.blocks).find(b => b.type === 'contact-form');
    const variant = mutate => { const c = JSON.parse(JSON.stringify(base)); mutate(formBlock(c).fields); return validate(c); };
    if (!variant(f => { delete f.formAction; f.delivery = { mode: 'netlify' }; }).ok) {
      failures.push('schema rejected netlify mode without formAction');
    }
    if (variant(f => { delete f.formAction; }).ok) failures.push('schema accepted a missing formAction with no delivery mode');
    if (variant(f => { delete f.formAction; f.delivery = { mode: 'endpoint' }; }).ok) {
      failures.push('schema accepted endpoint mode without formAction');
    }
    if (variant(f => { f.formAction = 'http://insecure.example/f'; }).ok) failures.push('schema accepted a non-https formAction');
    if (variant(f => { f.delivery = { mode: 'netlify', successPath: 'javascript:alert(1)' }; }).ok) {
      failures.push('schema accepted a successPath carrying a URL scheme');
    }
    if (variant(f => { f.delivery = { mode: 'paid-relay' }; }).ok) failures.push('schema accepted an unknown delivery mode');

    // (c) The honeypot never carries an annotation: in the ANNOTATED build it
    //     appears verbatim (no data-bk-* inside), while the form's real
    //     fields stay annotated. Proof 1 (already run above) covers the rest
    //     of the annotation contract whole.
    build('example-contractor', ['--annotate']);
    const annHtml = fs.readFileSync(path.join(ROOT, 'dist', 'example-contractor__annotated', 'contact.html'), 'utf8');
    if (count(annHtml, HP) !== 1) failures.push('annotated build: honeypot missing or carrying annotations');
    if (!annHtml.includes('data-bk-field="formAction"')) failures.push('annotated build lost the formAction annotation');

    // (d) The placeholder warns at build time and the build still succeeds;
    //     a netlify-mode client builds end-to-end with the attributes live.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const c1 = JSON.parse(JSON.stringify(base));
    formBlock(c1).fields.formAction = 'https://UNCONFIGURED';
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(c1, null, 2) + '\n', 'utf8');
    const b1 = build(CLIENT);
    if (!b1.ok) failures.push(`placeholder formAction failed the build (it must only warn):\n${b1.out}`);
    if (!/still points at the placeholder endpoint https:\/\/UNCONFIGURED/.test(b1.out) || !b1.out.includes('"contact-form"')) {
      failures.push(`placeholder warning missing or does not name the block: ${b1.out}`);
    }
    const c2 = JSON.parse(JSON.stringify(base));
    delete formBlock(c2).fields.formAction;
    formBlock(c2).fields.delivery = { mode: 'netlify', successPath: 'thanks.html' };
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(c2, null, 2) + '\n', 'utf8');
    const b2 = build(CLIENT);
    if (!b2.ok) failures.push(`netlify-mode client failed to build:\n${b2.out}`);
    else {
      const nfLive = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'contact.html'), 'utf8');
      if (!nfLive.includes('data-netlify="true"') || !nfLive.includes('netlify-honeypot="_gotcha"')) {
        failures.push('netlify attributes missing from the built page');
      }
      if (/still points at the placeholder/.test(b2.out)) failures.push('placeholder warning fired without the placeholder');
    }

    // (e) extras/ is deploy-time material (the Cloudflare form worker), not
    //     engine runtime: no file under engine/ may require/import from it.
    const offenders = [];
    (function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(p);
        else if (entry.name.endsWith('.js')
                 && /require\s*\([^)]*extras|from\s+['"][^'"]*extras/.test(fs.readFileSync(p, 'utf8'))) {
          offenders.push(path.relative(ROOT, p));
        }
      }
    })(path.join(ROOT, 'engine'));
    if (offenders.length) failures.push(`engine code requires from extras/: ${offenders.join(', ')}`);
    if (!fs.existsSync(path.join(ROOT, 'extras', 'cloudflare-form-worker', 'worker.js'))) {
      failures.push('extras/cloudflare-form-worker/worker.js is missing');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, 'dist', CLIENT), { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — endpoint-mode rendering equals the previous output plus exactly the');
    console.log('       honeypot line (verified against a byte-level golden and a real client);');
    console.log('       netlify mode emits name/data-netlify/netlify-honeypot/form-name and the');
    console.log('       configured success redirect, with formAction optional ONLY there; the');
    console.log('       honeypot is never annotated; https://UNCONFIGURED warns and never fails;');
    console.log('       nothing under extras/ is required by engine code.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`${passed}/${TOTAL} proofs passed.`);
process.exit(passed === TOTAL ? 0 : 1);
