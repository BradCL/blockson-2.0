#!/usr/bin/env node
'use strict';
// Runs the end-to-end proof suite in sequence and prints results.
// Proofs 1–4: the original patch/rebuild/rollback path.
//   Proof 1 also guards the v4 annotated preview build: live HTML carries no
//   ids and no data-bk-* attributes; an annotated build carries a data-bk
//   annotation for every editable field the edit map reports.
// Proofs 5–6: the v2 token-editing path (allowlist + format + contrast guards).
// Proof 7:    resolver value guards — valueless writes are rejected.
// Proof 8:    owner-editor request handlers (engine/lib/owner.js) exercised
//             directly: edit → candidate-only write + annotated rebuild →
//             keep (stage) → next edit allowed → publish → live write +
//             clean live build, the whole session in one step; the
//             one-pending-change gate, staged changes surviving a
//             pending-discard (replay), resolver guards on the UI path,
//             uploads riding the session, discard-all.
// Proof 9:    blueprint scaffolder (engine/lib/scaffold.js): registry loads
//             and validates all shipped blueprints; invalid inputs rejected
//             with nothing written; ids unique site-wide under repeated
//             instantiation; every blueprint × variant builds clean.
// Proof 10:   scaffold through the owner handlers: candidate-only page add
//             with annotations, pending interlock with edits, keep → the
//             page survives a pending-discard replay with the same ids,
//             publish → page + nav entry live with no annotations, no ids.
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
//             path traversal confined, nosniff + SAMEORIGIN on responses;
//             access token (v4.2 Task 2): remote-open refuses to start
//             without one; configured, it gates every request — wrong/no
//             token refused with a plain page, right token admits and sets
//             an HttpOnly session cookie honored for static + API requests
//             (POST header still required); loopback-no-token unchanged.
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
// Proof 16:   maintenance ledger (engine/lib/owner.js): every handler
//             attempt appends one JSONL line (timestamp, request as
//             submitted, outcome, error verbatim); uploads logged by
//             name/size only; rotation at 1 MB; an unwritable ledger
//             never blocks the edit it describes.
// Proof 17:   per-block visibility flag (fields.hidden, boolean): hidden
//             blocks absent from live HTML, present + data-bk-hidden in
//             the annotated preview, toggle round-trips through applyPatch
//             with boolean values, type-preservation guards hold both
//             ways, absent flag means visible, the flag is seeded on the
//             example clients and the starter, and the edit map reports
//             it as block metadata (never a scalar).
// Proof 18:   session batching over real git (v4.2 Task 3), in a throwaway
//             sandbox repository under dist/ with a local bare origin:
//             keeping changes never touches git; publishing a multi-change
//             session makes exactly ONE pushed commit carrying the
//             [blockson-publish <client>] marker; restore refuses while
//             changes are staged and, once clear, reverts the whole
//             session as one unit; a failed outward push leaves a retryable
//             waiting publish that succeeds once the remote is fixed.
// Proof 19:   item blueprints + removeItem (v4.2 Task 4): five item
//             blueprints validate (cta-button is proof 27); a valid add lands in the named
//             block with a site-wide-unique item id and builds clean;
//             invalid inputs/targets rejected with nothing written; remove
//             deletes exactly the addressed item, refuses the last item
//             and any un-blessed array; both ride pending → keep → publish
//             with annotation-free, id-free live HTML; a known-bad item
//             blueprint fails the CLI with named reasons.
// Proof 20:   page-header background inheritance (engine fix from the first
//             live site): a page-header that omits its own background inherits
//             the site hero image — the home page's hero background, derived in
//             build.js — even when that hero is not named banner.jpg, which the
//             theme-CSS-only fallback silently broke; an explicit page-header
//             background still wins; and a site with no hero at all emits no
//             inline background, leaving the theme CSS as the last-ditch default.
// Proof 21:   header background focal-point + zoom (owner-editable bgPosition /
//             bgZoom on the hero AND the page-header): out-of-range or malformed
//             values are refused by the per-field format guard in patch.js with
//             nothing written; a valid pair round-trips through applyPatch and
//             reaches the built header as inline background-position /
//             transform:scale (the live HTML carrying only that inline style —
//             no ids, no data-bk-*); a numeric-string zoom is normalized to a
//             number; the fields are optional (absent → byte-identical to the
//             pre-feature paint); and the edit map reports them as block
//             metadata, never scalars (so proof 1 demands no annotation for an
//             element no renderer emits). The page-header rides the SAME guarded
//             path — keyed on the background field, not the block type.
// Proof 22:   og:image fallback precedence (engine/partials/head.js): with no
//             per-page meta.ogImage, a page's social card is the site hero photo
//             (home and interior pages alike) rather than the logo — a logo
//             often renders as a broken-looking transparent PNG; an explicit
//             per-page ogImage still wins; a hero `background` that is not an
//             image (the schema only types it as a string) is guarded out and
//             falls through to the logo; and with no hero anywhere the logo is
//             the last resort, so the tag is never broken-missing.
// Proof 23:   unreferenced-image advisory (engine/build.js): an image sitting in
//             img/ that nothing reaches (including a nested one) is named on
//             stderr so it can be pruned, while images reached through any real
//             channel — content fields, the logo/favicon trio, a per-page
//             og-image, or the theme CSS's hard-coded banner — are spared (no
//             crying wolf), and the build still succeeds (exit 0).
// Proof 24:   reachable section backgrounds (engine half of the click-to-edit
//             fix): a behind-content background (hero / page-header) is painted
//             under the content at a negative z-index, so the overlay can only
//             route a dead-space click to it via a marker. The annotated build
//             stamps data-bk-bg on each background, paired with its
//             data-bk-field="background", as a DIRECT CHILD of its section (the
//             structure the overlay's section-walk relies on); the marker rides
//             ONLY background fields; and a live build carries neither the
//             marker nor any data-bk-* (no preview-only attribute leaks live).
//             The overlay's own click resolution is browser JS, exercised in
//             the UI rather than this Node harness.
// Proof 25:   per-page page-header background (owner can set an image where the
//             header inherits the site hero): the edit map exposes background on
//             a header that omits it and the annotated build marks it; the patch
//             resolver's narrow CREATABLE allowlist creates the field ONLY for a
//             page-header background set to an image-path value — a non-image
//             value, an unrelated new field, and a background on a non-header
//             block are all refused with nothing written; the owner editor opens
//             it as an image whose current value is the inherited hero; and a
//             created per-page background rides keep → publish to live HTML that
//             shows the new image (overriding the inherited hero) with no
//             annotations or ids.
// Proof 26:   section doorway (the click-to-edit blind spot — you can only click
//             RENDERED things): a section's omitted OPTIONAL text (a page-header
//             subtitle) surfaces as a CREATABLE field (never a scalar, so the
//             annotation proof isn't over-constrained) while a required hero
//             subhead stays an ordinary scalar; the resolver creates it only for
//             a one-line text value on an allowlisted block; describeSection
//             reports the section's settings + addable fields; and a created
//             subtitle publishes with no annotations or chip leaking live.
// Proof 27:   editable CTA buttons (builds on the doorway): extras/add-action-ids.js
//             seeds a slugified, site-wide-unique id on every hero button
//             (numeric-suffixed on a label collision) and is idempotent; a
//             migrated hero exposes its actions as an item set whose only click
//             field is label (the annotated build marks each button there, never
//             its href/style) while the live build stays byte-identical and
//             data-bk-free; label/link/style each edit through the item path with
//             the build as the value gate (an unsafe link and an out-of-enum
//             style roll back), a button removes via the item path (the last one
//             refused), and the scaffold relaxation adds the FIRST button to an
//             empty actions array through the Section-panel doorway — live only
//             on publish, no annotations or ids leaking in.
// Proof 28:   host seam (engine/lib/owner.js × an injected non-Node host): the
//             SAME owner handlers drive an entirely in-memory host — content in
//             JS strings, images in a Map, the acceptance "build" the engine's
//             own validate() run with no filesystem (schema pre-seeded via
//             validate.setSchema, blueprints via scaffold.setBlueprintRegistry)
//             — through the same edit → keep → second edit → keep →
//             pending-discard (replay) → discard-all cycle the Node path runs in
//             proof 8: the one-pending-change gate holds, kept changes survive a
//             pending-discard replay, the resolver guards still bounce a
//             forbidden field and an unsafe token, an uploaded image rides the
//             candidate Map (never the live Map) and survives the replay once
//             kept, the ledger boundary still fires one entry per attempt
//             through the injected sink, and Publish is a no-op PROPERTY OF THE
//             HOST (shipSession reports nothing shipped) that leaves the staged
//             session intact — proving the adapter can't silently diverge from
//             the disk/git host without owner.js itself changing.
// Proof 29:   heavy-gallery advisory: a photo-laden album gets a soft,
//             plain-language page-weight heads-up in the editor — computed in
//             owner.js so Node and browser hosts show it identically — and the
//             advisory never caps an edit; flat text lists never get it.
// Proof 30:   hostile content values render inert: a payload carrying an
//             unquoted-attribute breakout, a backtick, both quote kinds, and a
//             full <img onerror> element is written through applyPatch into
//             every free-text field of a corpus covering all 23 block types;
//             the live build succeeds and no built tag gains an event-handler
//             attribute, no raw payload markup appears, and the payload
//             survives only as escaped visible text — the esc()/quoted-
//             attribute discipline proven at the rendered surface.
// Proof 31:   no-AJV fallback: with the ajv/ajv-formats packages made
//             unresolvable, a valid client still builds (exit 0) with a loud
//             warning naming the fix; the same build with AJV present emits no
//             warning; and the reduced validator still refuses a javascript:
//             href and structurally-empty content with nothing written — the
//             degraded path is exercised, not just promised.
// Proof 32:   photo-strip doorways (the accessibility defect found on a live
//             site): a linked cell takes its accessible name from the cue — the
//             owner-editable linkLabel — with the image decorative inside the
//             link (alt="") and only the arrow aria-hidden, so four linked
//             photos stop announcing as four identical site names; the cue is
//             visible by default and fades only under @media (hover: hover), so
//             a touch device sees a label at all; and a link-less photo is
//             untouched, keeping its site-name alt and no cue.
// Proof 33:   photo-strip column count: `columns` rides the SECTION as a custom
//             property (absent → nothing emitted at all, and CSS still resolves
//             the historical 4-wide grid; present → the responsive steps can
//             still override it, which an inline grid-template-columns would
//             forbid), and the schema enum refuses anything out of range.
// Proof 34:   card-grid card links: a services overview becomes a real
//             directory (a card per service, pointing at that service's page).
//             A link-less card is byte-identical to before; a linked card
//             carries exactly one always-visible anchor whose accessible name
//             is the cue text plus a screen-reader-only card title, so no two
//             cards announce alike; link and linkLabel are click-to-editable
//             and owner-repointable through the ordinary item path; and a
//             javascript: target is refused by BOTH validators — including the
//             no-AJV fallback, which previously scanned only keys named `href`
//             and would have waved a `link` straight through.
// Proof 35:   nav submenus: a nav link may carry one level of children. The
//             parent STAYS A REAL LINK to its hub page (the only way in where
//             hover does not exist), reads as active whenever any child is the
//             current page, and keeps its decorative caret out of the link
//             name; a childless link renders byte-identically; child hrefs ride
//             the same scheme guard, a second level of nesting is refused, and
//             the stylesheet keeps :focus-within ungated while :hover is gated
//             behind a pointer that can actually hover.
// Proof 36:   footer column count: `footer.columns` has always been unbounded
//             while the CSS was `2fr 1fr 1fr 1fr`. The grid now reads a track
//             count the partial emits ONLY when it is not three, so an existing
//             three-column footer is byte-identical and still resolves to the
//             historical template, while a fourth column gets its own track.
// Proof 37:   the eight building-trade glyphs resolve to real SVG and reach a
//             built page through the ordinary card `icon` field, and
//             BLOCK_CATALOG's published list matches the set in BOTH
//             directions — that list is the contract the maintenance tier
//             reads, and an unknown name renders as nothing at all.
// Proof 38:   a contact-form's `source` tag: two forms can share one inbox and
//             still be told apart, in both delivery modes, with a hostile value
//             rendering inert and an unset field leaving the form
//             byte-identical — and the tag is provably NOT owner surface: absent
//             from the edit map, un-annotated in the annotated preview, and
//             refused by applyPatch at the field and via a dotted path.
// Proof 39:   reviews-link's optional rating/reviewCount/label are no longer a
//             one-way door: each is creatable through the same allowlist a
//             page-header subtitle uses, the shape guard holds on BOTH the
//             create and the overwrite path (so a cleared rating can only come
//             back as a rating), clearing one hands back the doorway instead of
//             leaving an unclickable field, and a refused value says why.
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
const TOTAL = 39;
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
console.log('\n═══ PROOF 8 — Owner-editor handlers, exercised directly: edit → keep → publish ═══');
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
      if (live.pages[0].blocks[0].fields.headline === NEW) failures.push('LIVE content was touched before publish');
      if (!fs.readFileSync(candIndexPath, 'utf8').includes(NEW)) failures.push('candidate preview was not rebuilt');
    }

    // (d) Exactly one pending change at a time — staging is a new layer;
    //     the pending rule is unchanged.
    const e2 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'subhead', value: 'x' });
    if (e2.ok) failures.push('a second edit was accepted while one was pending');

    // (e) Keep: the pending change joins the staged list with its card,
    //     live is still untouched, and the next edit can begin.
    const k1 = owner.keep(session);
    if (!k1.ok) failures.push(`keep failed: ${k1.error}`);
    else if (session.pending || k1.staged.length !== 1 || k1.staged[0].new !== NEW) {
      failures.push(`keep did not stage the change card: ${JSON.stringify(k1.staged)}`);
    }
    const NEW2 = 'Open every winter evening.';
    const e3 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'subhead', value: NEW2 });
    if (!e3.ok) failures.push(`the edit after a keep was refused: ${e3.error}`);
    const k2 = owner.keep(session);
    if (!k2.ok || k2.staged.length !== 2) failures.push('the second keep did not extend the staged list');
    const liveMid = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
    if (liveMid.pages[0].blocks[0].fields.headline === NEW || liveMid.pages[0].blocks[0].fields.subhead === NEW2) {
      failures.push('LIVE content was touched by keep');
    }

    // (f) Staged changes survive a pending-discard: the candidate is
    //     reconstructed from live + a replay of the staged list, dropping
    //     only the pending change.
    const e4 = owner.applyEdit(session, { action: 'set', block: 'site', field: 'copyright', value: 'Temporary line.' });
    if (!e4.ok) failures.push(`third edit failed: ${e4.error}`);
    const disc1 = owner.discard(session);
    if (!disc1.ok) failures.push(`pending-discard failed: ${disc1.error}`);
    const candReplayed = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
    if (candReplayed.pages[0].blocks[0].fields.headline !== NEW
        || candReplayed.pages[0].blocks[0].fields.subhead !== NEW2) {
      failures.push('a pending-discard disturbed the staged changes');
    }
    if (candReplayed.site.copyright === 'Temporary line.') failures.push('the discarded pending change survived the replay');
    if (!fs.readFileSync(candIndexPath, 'utf8').includes(NEW)) failures.push('candidate preview lost a staged change after a pending-discard');

    // (g) Publish refuses while a change is pending — a pending change is
    //     never silently included in a publish.
    owner.applyEdit(session, { action: 'set', block: 'site', field: 'copyright', value: 'Temporary again.' });
    const pBlocked = owner.publish(session);
    if (pBlocked.ok) failures.push('publish ran over a pending change');
    owner.discard(session);

    // (h) Publish: the WHOLE staged session lands on live in one step, the
    //     live build is clean of annotations, the publish command would run
    //     once (skipped here: publish "none"), and the session empties —
    //     publishing again with nothing staged is refused.
    const pub = owner.publish(session);
    if (!pub.ok) failures.push(`publish failed: ${pub.error}`);
    else {
      if (!pub.publish.skipped) failures.push('publish ran a command despite publish:"none"');
      const live2 = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if (live2.pages[0].blocks[0].fields.headline !== NEW || live2.pages[0].blocks[0].fields.subhead !== NEW2) {
        failures.push('publish did not write the whole session to live content.json');
      }
      const liveHtml = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      if (!liveHtml.includes(NEW) || !liveHtml.includes(NEW2)) failures.push('live build is missing a published value');
      if (liveHtml.includes('data-bk-')) failures.push('live build contains data-bk-* after publish');
    }
    if (owner.publish(session).ok) failures.push('publish succeeded with nothing staged');

    // (i) The resolver guards run unchanged on the UI path: forbidden field
    //     and unsafe token value both bounce, nothing staged.
    const g1 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'id', value: 'x' });
    const g2 = owner.applyEdit(session, { action: 'set-token', token: '--color-primary', value: 'red;background:url(evil)' });
    if (g1.ok || g2.ok || session.pending) failures.push('a guarded write slipped through the edit handler');

    // (j) Uploads ride the session candidate-side: the file lands in
    //     candidate img/ under a handler-assigned path, survives a
    //     pending-discard once kept (the replay rewrites it), and
    //     discard-all removes it — live img/ never sees it.
    const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const e5 = owner.applyEdit(session,
      { action: 'set', block: 'home-team', item: 'member-chef', field: 'photo' },
      { name: 'new portrait.png', dataBase64: PNG_1PX });
    if (!e5.ok) failures.push(`image edit failed: ${e5.error}`);
    else {
      if (e5.pending.new !== 'img/new-portrait.png') failures.push(`image path not assigned by the handler: ${e5.pending.new}`);
      if (!fs.existsSync(path.join(candDir, 'img', 'new-portrait.png'))) failures.push('uploaded image missing from candidate img/');
    }
    owner.keep(session);
    owner.applyEdit(session, { action: 'set', block: 'site', field: 'copyright', value: 'Replay check.' });
    owner.discard(session);
    if (!fs.existsSync(path.join(candDir, 'img', 'new-portrait.png'))) {
      failures.push('a kept upload did not survive the pending-discard replay');
    }
    const dAll = owner.discardAll(session);
    const candText = fs.readFileSync(path.join(candDir, 'content.json'), 'utf8');
    const liveText = fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8');
    if (!dAll.ok || candText !== liveText) failures.push('discard-all did not reset the candidate from live');
    if (fs.existsSync(path.join(candDir, 'img', 'new-portrait.png'))) failures.push('discard-all left the uploaded image in the candidate');
    if (fs.existsSync(path.join(liveDir, 'img', 'new-portrait.png'))) failures.push('a discarded upload leaked into live img/');

    // (k) Upload signature guard: the bytes must BE the image type the name
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
    console.log('       rebuilds its annotated preview; keep stages the change card and frees');
    console.log('       the next edit; a pending-discard replays the staged list and disturbs');
    console.log('       nothing kept; publish refuses over a pending change, then ships the');
    console.log('       whole session to live in one step with clean HTML; guards hold;');
    console.log('       uploads stay candidate-side, survive the replay once kept, and vanish');
    console.log('       on discard-all; non-image bytes under an image name are refused.');
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
    // (a) Registry: every shipped blueprint loads and validates; nothing invalid.
    const reg = scaffold.loadBlueprints();
    const keys = reg.blueprints.map(b => b.key);
    for (const want of ['contact-page', 'content-page', 'gallery-page',
                        'card-grid-card', 'faq-pair', 'testimonial-quote', 'team-member']) {
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
    console.log('PASS — registry validates all 7 blueprints; 8 classes of bad input rejected with');
    console.log('       content untouched; 12 same-name instantiations + every page blueprint × variant');
    console.log('       coexist with unique slugs and block ids, and the full build accepts the result.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 10 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 10 — Scaffold through the owner handlers: candidate page → keep → publish, no annotations ═══');
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

    // (c) Keep the scaffold, then discard a later pending edit: the kept
    //     page must survive the replay (deterministic re-instantiation —
    //     same slug, same block ids) while the discarded edit vanishes.
    const k = owner.keep(session);
    if (!k.ok) failures.push(`keep failed: ${k.error}`);
    const e2 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: 'Replay check' });
    if (!e2.ok) failures.push(`the edit after keeping a scaffold was refused: ${e2.error}`);
    const disc = owner.discard(session);
    if (!disc.ok) failures.push(`pending-discard failed: ${disc.error}`);
    const candReplayed = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
    const photosPage = candReplayed.pages.find(p => p.slug === 'photos');
    if (!photosPage) failures.push('the kept page did not survive a pending-discard');
    else if (photosPage.blocks[0].id !== 'photos-header') {
      failures.push(`replaying the kept scaffold changed its block ids: ${photosPage.blocks[0].id}`);
    }
    if (candReplayed.pages[0].blocks[0].fields.headline === 'Replay check') {
      failures.push('the discarded edit survived the replay');
    }

    // (d) Publish: page + nav entry live; live HTML free of annotations and ids.
    const a = owner.publish(session);
    if (!a.ok) failures.push(`publish failed: ${a.error}`);
    else {
      const live2 = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if (!live2.pages.some(p => p.slug === 'photos')) failures.push('published page missing from live content');
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
    console.log('       kept, it survives a pending-discard replay with the same slug and ids;');
    console.log('       publish puts the page, its nav entry, and its sitemap line live with');
    console.log('       no annotations and no ids in the HTML.');
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
    console.log(`       pairs, demo-client coverage build of all ${Object.keys(BLOCKS).length} block types); a known-bad`);
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
  // serve.js documents five request guards (loopback-only, Host-header check,
  // editor-header requirement on POST, static-path confinement, and the
  // access-token gate) plus the defense-in-depth response headers. They are
  // HTTP plumbing, so unlike the owner.js handlers they cannot be proved by
  // direct calls — this proof starts the REAL server (on an OS-assigned port)
  // and probes it with raw requests: once with no token configured (the
  // unchanged loopback behavior) and once remote-style (allowRemote +
  // accessToken). The async client lives in a harness script written under
  // dist/ (the same pattern as the bad-blueprint/bad-theme artifacts) because
  // this proof runner is deliberately straight-line synchronous.
  const CLIENT  = '__proof-serve';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const harness = path.join(ROOT, 'dist', '__proof-serve-harness.js');
  const failures = [];

  const HARNESS_SRC = [
    "'use strict';",
    "const { spawn } = require('child_process');",
    "const http = require('http');",
    "const fs = require('fs');",
    "const path = require('path');",
    "const ROOT = process.argv[2], CLIENT = process.argv[3];",
    "const failures = [];",
    "let done = false;",
    "function startServer() {",
    "  return new Promise(function (resolve) {",
    "    const srv = spawn(process.execPath, [path.join(ROOT, 'engine', 'serve.js'), CLIENT, '--port', '0'], { cwd: ROOT });",
    "    let out = '', settled = false;",
    "    function settle(port) { if (!settled) { settled = true; clearTimeout(giveUp); resolve({ srv: srv, port: port, out: out }); } }",
    "    const giveUp = setTimeout(function () { settle(null); }, 30000);",
    "    srv.stdout.on('data', function (d) {",
    "      out += d;",
    "      const m = out.match(/http:\\/\\/127\\.0\\.0\\.1:(\\d+)\\//);",
    "      if (m) settle(Number(m[1]));",
    "    });",
    "    srv.stderr.on('data', function (d) { out += d; });",
    "    srv.on('exit', function () { settle(null); });",
    "  });",
    "}",
    "function req(port, opts, body) {",
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
    "  let s1 = null, s2 = null;",
    "  try {",
    "    // ── Phase 1: no accessToken configured, plain loopback — the v4",
    "    //    behavior, which Task 2 must leave exactly as it was.",
    "    s1 = await startServer();",
    "    if (s1.port === null) { failures.push('server (no-token) did not start: ' + s1.out.slice(-400)); return finish(s1, s2); }",
    "    // (a) A local request works WITHOUT any token or cookie, and every",
    "    //     response carries the defense-in-depth headers.",
    "    const home = await req(s1.port, { path: '/' });",
    "    if (home.status !== 200) failures.push('GET / expected 200, got ' + home.status);",
    "    if (home.headers['x-content-type-options'] !== 'nosniff') failures.push('GET / is missing X-Content-Type-Options: nosniff');",
    "    if (home.headers['x-frame-options'] !== 'SAMEORIGIN') failures.push('GET / is missing X-Frame-Options: SAMEORIGIN');",
    "    const state = await req(s1.port, { path: '/api/state' });",
    "    if (state.status !== 200) failures.push('no-token /api/state expected 200, got ' + state.status);",
    "    if (state.headers['x-content-type-options'] !== 'nosniff') failures.push('API responses are missing nosniff');",
    "    // (b) A loopback request wearing a foreign Host header (DNS-rebinding",
    "    //     shape) is refused.",
    "    const rebind = await req(s1.port, { path: '/', headers: { Host: 'evil.example.com' } });",
    "    if (rebind.status !== 403) failures.push('foreign Host header expected 403, got ' + rebind.status);",
    "    // (c) A POST without the editor header (what a cross-origin page",
    "    //     could send) is refused; the same POST with the header reaches",
    "    //     the handler (token-check: a guard run, no write).",
    "    const naked = await req(s1.port, { method: 'POST', path: '/api/token-check', headers: { 'Content-Type': 'application/json' } }, '{}');",
    "    if (naked.status !== 403) failures.push('headerless POST expected 403, got ' + naked.status);",
    "    const armed = await req(s1.port, { method: 'POST', path: '/api/token-check',",
    "      headers: { 'Content-Type': 'application/json', 'x-blockson-ui': '1' } },",
    "      JSON.stringify({ token: '--color-primary', value: '#2D6A4F' }));",
    "    if (armed.status !== 200) failures.push('editor POST expected 200, got ' + armed.status + ' ' + armed.body.slice(0, 200));",
    "    // (d) Encoded traversal out of the preview/UI roots must not serve",
    "    //     repo files (package.json is the canary).",
    "    const t1 = await req(s1.port, { path: '/preview/%2e%2e%2fpackage.json' });",
    "    if (t1.status === 200 || t1.body.indexOf('blockson') !== -1) failures.push('encoded ../ escaped the preview root (' + t1.status + ')');",
    "    const t2 = await req(s1.port, { path: '/preview/..%5C..%5Cpackage.json' });",
    "    if (t2.status === 200 || t2.body.indexOf('blockson') !== -1) failures.push('encoded ..\\\\ escaped the preview root (' + t2.status + ')');",
    "    const t3 = await req(s1.port, { path: '/ui/%2e%2e%2fserve.js' });",
    "    if (t3.status === 200) failures.push('/ui/ served a file outside its allowlist');",
    "    s1.srv.kill();",
    "    // ── Phase 2: accessToken + allowRemote — the Task 2 hardening.",
    "    //    Requests still arrive over loopback, but allowRemote disables",
    "    //    the locality guard, so they exercise exactly the remote path.",
    "    fs.writeFileSync(path.join(ROOT, 'clients', CLIENT, 'owner-config.json'),",
    "      JSON.stringify({ clientName: 'Proof Client', publish: 'none', allowRemote: true, accessToken: 'proof-secret-token' }) + '\\n', 'utf8');",
    "    s2 = await startServer();",
    "    if (s2.port === null) { failures.push('server (token mode) did not start: ' + s2.out.slice(-400)); return finish(s1, s2); }",
    "    // (e) Remote-style request without token or cookie: refused with a",
    "    //     plain-language page, never a stack trace.",
    "    const bare = await req(s2.port, { path: '/' });",
    "    if (bare.status !== 403) failures.push('token-mode GET / without token expected 403, got ' + bare.status);",
    "    if (!/access link/i.test(bare.body)) failures.push('refusal is not the plain-language page: ' + bare.body.slice(0, 200));",
    "    if (bare.body.indexOf('    at ') !== -1) failures.push('refusal page leaks a stack trace');",
    "    // (f) Wrong token: refused, and no session cookie issued.",
    "    const wrong = await req(s2.port, { path: '/?token=wrong-token' });",
    "    if (wrong.status !== 403) failures.push('wrong token expected 403, got ' + wrong.status);",
    "    if (wrong.headers['set-cookie']) failures.push('wrong token was issued a session cookie');",
    "    // (g) Right token: admitted, and answered with an HttpOnly cookie.",
    "    const right = await req(s2.port, { path: '/?token=proof-secret-token' });",
    "    if (right.status !== 200) failures.push('right token expected 200, got ' + right.status);",
    "    const setCookie = (right.headers['set-cookie'] || [])[0] || '';",
    "    if (!/HttpOnly/i.test(setCookie)) failures.push('session cookie is missing or not HttpOnly: ' + setCookie);",
    "    const cookie = setCookie.split(';')[0];",
    "    // (h) The cookie alone now admits API and static requests alike;",
    "    //     without it both are refused.",
    "    const cApi = await req(s2.port, { path: '/api/state', headers: { Cookie: cookie } });",
    "    if (cApi.status !== 200) failures.push('cookie-bearing /api/state expected 200, got ' + cApi.status);",
    "    const cStatic = await req(s2.port, { path: '/ui/ui.js', headers: { Cookie: cookie } });",
    "    if (cStatic.status !== 200) failures.push('cookie-bearing /ui/ui.js expected 200, got ' + cStatic.status);",
    "    const nApi = await req(s2.port, { path: '/api/state' });",
    "    if (nApi.status !== 403) failures.push('cookieless /api/state expected 403, got ' + nApi.status);",
    "    const nStatic = await req(s2.port, { path: '/ui/ui.js' });",
    "    if (nStatic.status !== 403) failures.push('cookieless /ui/ui.js expected 403, got ' + nStatic.status);",
    "    // (i) The custom-header POST requirement is IN ADDITION to the",
    "    //     cookie: cookie without header refused, cookie + header admitted.",
    "    const cNakedPost = await req(s2.port, { method: 'POST', path: '/api/token-check',",
    "      headers: { Cookie: cookie, 'Content-Type': 'application/json' } }, '{}');",
    "    if (cNakedPost.status !== 403) failures.push('cookie-but-headerless POST expected 403, got ' + cNakedPost.status);",
    "    const cArmedPost = await req(s2.port, { method: 'POST', path: '/api/token-check',",
    "      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'x-blockson-ui': '1' } },",
    "      JSON.stringify({ token: '--color-primary', value: '#2D6A4F' }));",
    "    if (cArmedPost.status !== 200) failures.push('cookie + header POST expected 200, got ' + cArmedPost.status + ' ' + cArmedPost.body.slice(0, 200));",
    "  } catch (e) {",
    "    failures.push('exception: ' + e.message);",
    "  }",
    "  finish(s1, s2);",
    "}",
    "function finish(s1, s2) {",
    "  if (done) return;",
    "  done = true;",
    "  try { if (s1) s1.srv.kill(); } catch (e) {}",
    "  try { if (s2) s2.srv.kill(); } catch (e) {}",
    "  console.log('PROOF13RESULT ' + JSON.stringify({ failures: failures }));",
    "  process.exit(0);",
    "}",
    "run();",
  ].join('\n');

  try {
    // Throwaway client, publishing off — same setup as proof 8.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
      path.join(liveDir, 'content.json'));
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Proof Client', publish: 'none' }) + '\n', 'utf8');

    // Remote-open without an access token must refuse to START — checked
    // here while the throwaway config still has no token (it fails fast,
    // before the candidate build, so this never hangs the suite).
    const refusal = spawnSync(process.execPath,
      [path.join(ROOT, 'engine', 'serve.js'), CLIENT, '--allow-remote', '--port', '0'],
      { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    if (refusal.status === 0 || !/accessToken/.test(refusal.stderr || '')) {
      failures.push(`--allow-remote without accessToken must refuse to start, naming accessToken; got status ${refusal.status}: ${((refusal.stderr || '') + (refusal.stdout || '')).slice(0, 300)}`);
    }

    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    fs.writeFileSync(harness, HARNESS_SRC, 'utf8');
    // Two server starts (two candidate builds) live inside the harness now.
    const r = spawnSync(process.execPath, [harness, ROOT, CLIENT],
      { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
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
    console.log('       preview or UI roots; remote-open refuses to start without an access');
    console.log('       token; with one set, no-token and wrong-token requests get the plain-');
    console.log('       language page, the right token is admitted and issued an HttpOnly');
    console.log('       cookie that then admits static and API alike (the POST header still');
    console.log('       required on top); loopback without a configured token is unchanged.');
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
    // Scoped to the WEIGHT message shape ("… is <n> KB/MB"): a small file is
    // never named for its size. (It may legitimately appear in the separate
    // unreferenced-image advisory — "… is not referenced" — which proof 23 owns.)
    if (/small-icon\.png is \d+ (KB|MB)/.test(b2.out)) failures.push('a file under the limit was named in a weight warning');
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

// ── PROOF 16 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 16 — Maintenance ledger: every attempt logged, bytes never, a failed write never blocks ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-ledger';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const ledgerFile  = path.join(liveDir, 'edits.log.jsonl');
  const rotatedFile = path.join(liveDir, 'edits.log.1.jsonl');
  const failures = [];

  const readLines = () => fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const last = () => { const ls = readLines(); return ls[ls.length - 1]; };

  try {
    // Throwaway client, publishing off — same setup as proof 8.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
      path.join(liveDir, 'content.json'));
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Proof Client', publish: 'none' }) + '\n', 'utf8');

    const session = owner.createSession(CLIENT);

    // (a) An accepted edit appends one well-formed line: ISO timestamp,
    //     event "edit", the patch as submitted, outcome "ok".
    const okEdit = owner.applyEdit(session,
      { action: 'set', block: 'home-hero', field: 'headline', value: 'Ledger headline.' });
    if (!okEdit.ok) failures.push(`setup edit failed: ${okEdit.error}`);
    let line = last();
    if (line.event !== 'edit' || line.outcome !== 'ok') failures.push(`accepted edit logged wrong: ${JSON.stringify(line)}`);
    if (!line.at || Number.isNaN(Date.parse(line.at))) failures.push('ledger line has no parseable ISO timestamp');
    if (!line.request || !line.request.patch || line.request.patch.field !== 'headline') {
      failures.push('accepted-edit line does not carry the patch as submitted');
    }

    // …and discard, which clears the pending change, is itself logged.
    owner.discard(session);
    line = last();
    if (line.event !== 'discard' || line.outcome !== 'ok') failures.push(`discard logged wrong: ${JSON.stringify(line)}`);

    // (b) A rejected edit logs outcome "rejected" with the resolver's
    //     refusal verbatim.
    const bad = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'id', value: 'x' });
    line = last();
    if (bad.ok) failures.push('a forbidden edit was accepted');
    if (line.event !== 'edit' || line.outcome !== 'rejected') failures.push(`rejected edit logged wrong: ${JSON.stringify(line)}`);
    if (!line.error || line.error !== bad.error) failures.push('rejected-edit line does not carry the resolver error verbatim');

    // (c) A scaffold logs event "scaffold" with the request as submitted;
    //     keep logs "keep" with the pending change it staged; publish logs
    //     "publish" with the staged list it shipped.
    const sc = owner.applyScaffold(session, {
      blueprint: 'gallery-page', variant: 'simple',
      values: { menuLabel: 'Photos', title: 'Our work', intro: 'Pictures.', albumTitle: 'Recent', photo: 'img/sample-1.jpg' },
    });
    if (!sc.ok) failures.push(`scaffold failed: ${sc.error}`);
    line = last();
    if (line.event !== 'scaffold' || line.outcome !== 'ok' || !line.request || line.request.blueprint !== 'gallery-page') {
      failures.push(`scaffold logged wrong: ${JSON.stringify(line)}`);
    }
    const kp = owner.keep(session);
    line = last();
    if (!kp.ok) failures.push(`keep failed: ${kp.error}`);
    if (line.event !== 'keep' || line.outcome !== 'ok' || !line.request || !line.request.summary) {
      failures.push(`keep logged wrong: ${JSON.stringify(line)}`);
    }
    const ap = owner.publish(session);
    line = last();
    if (!ap.ok) failures.push(`publish failed: ${ap.error}`);
    if (line.event !== 'publish' || line.outcome !== 'ok' || !line.request
        || !Array.isArray(line.request.staged) || line.request.staged.length !== 1) {
      failures.push(`publish logged wrong: ${JSON.stringify(line)}`);
    }

    // (d) An upload is logged by name and size only — the ledger never
    //     contains the file bytes.
    const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const up = owner.applyEdit(session,
      { action: 'set', block: 'home-team', item: 'member-chef', field: 'photo' },
      { name: 'portrait.png', dataBase64: PNG_1PX });
    if (!up.ok) failures.push(`image edit failed: ${up.error}`);
    line = last();
    if (!line.request || !line.request.upload || line.request.upload.name !== 'portrait.png'
        || line.request.upload.size !== Buffer.from(PNG_1PX, 'base64').length) {
      failures.push(`upload not logged by name/size: ${JSON.stringify(line.request)}`);
    }
    if (fs.readFileSync(ledgerFile, 'utf8').includes(PNG_1PX.slice(0, 24))) {
      failures.push('ledger contains uploaded file bytes');
    }
    owner.discard(session);

    // (e) Every line in the file honors the contract: parseable JSON, ISO
    //     timestamp, known event and outcome.
    for (const l of readLines()) {
      if (Number.isNaN(Date.parse(l.at || ''))) failures.push(`line without ISO timestamp: ${JSON.stringify(l)}`);
      if (!['edit', 'scaffold', 'remove-item', 'keep', 'discard', 'discard-all', 'publish', 'restore'].includes(l.event)) failures.push(`unknown event: ${l.event}`);
      if (!['ok', 'rejected', 'build-failed'].includes(l.outcome)) failures.push(`unknown outcome: ${l.outcome}`);
    }

    // (f) Rotation: past 1 MB the ledger is renamed to edits.log.1.jsonl
    //     (overwriting any previous .1) and a fresh file starts.
    fs.writeFileSync(rotatedFile, 'old rotation\n', 'utf8');
    const bulkLine = JSON.stringify({ at: new Date().toISOString(), event: 'edit', outcome: 'ok', pad: 'x'.repeat(1024) }) + '\n';
    fs.writeFileSync(ledgerFile, bulkLine.repeat(1100), 'utf8');
    owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: 'After rotation.' });
    owner.discard(session);
    if (!fs.existsSync(rotatedFile) || fs.statSync(rotatedFile).size <= 1024 * 1024) {
      failures.push('ledger was not rotated to edits.log.1.jsonl at 1 MB');
    } else {
      const rot = fs.readFileSync(rotatedFile, 'utf8');
      if (rot.includes('old rotation')) failures.push('rotation did not overwrite the previous .1 file');
      if (!rot.includes('"pad"')) failures.push('rotated file does not hold the pre-rotation content');
    }
    const fresh = readLines();
    if (fresh.length !== 2 || fresh[0].event !== 'edit' || fresh[1].event !== 'discard') {
      failures.push(`fresh post-rotation ledger expected [edit, discard], got ${JSON.stringify(fresh.map(l => l.event))}`);
    }

    // (g) Logging is a courtesy, not a control: with a directory squatting
    //     on the ledger path the append fails — and the edit still applies.
    fs.rmSync(ledgerFile, { force: true });
    fs.mkdirSync(ledgerFile);
    const blocked = owner.applyEdit(session,
      { action: 'set', block: 'home-hero', field: 'subhead', value: 'Still applies.' });
    if (!blocked.ok) failures.push(`an unwritable ledger blocked the edit: ${blocked.error}`);
    const cand = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
    if (cand.pages[0].blocks[0].fields.subhead !== 'Still applies.') {
      failures.push('the edit did not reach the candidate under an unwritable ledger');
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
    console.log('PASS — every owner-handler attempt appends one well-formed JSONL line (ISO');
    console.log('       timestamp, request as submitted, outcome, error verbatim on rejection);');
    console.log('       uploads are logged by name/size with no file bytes; the file rotates to');
    console.log('       edits.log.1.jsonl past 1 MB; and an unwritable ledger never blocks the');
    console.log('       edit it would have described.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 17 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 17 — Visibility flag: hidden blocks leave live HTML, stay reachable in the preview ═══');
{
  const STARTER = 'zz-proof-starter';
  const CLIENT  = '__proof-hidden';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const failures = [];
  const HERO_TEXT = 'Comfort food, wood-fired.';

  try {
    // (a) Seeding: every block of all three example clients carries the
    //     flag explicitly, and a freshly scaffolded client starts with it.
    for (const c of ['example-contractor', 'example-league', 'example-restaurant']) {
      const content = readContent(c);
      for (const p of content.pages) {
        for (const b of p.blocks) {
          if (typeof b.fields.hidden !== 'boolean') failures.push(`${c}: block "${b.id}" is missing the seeded hidden flag`);
        }
      }
    }
    fs.rmSync(path.join(ROOT, 'clients', STARTER), { recursive: true, force: true });
    const nc = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'new-client.js'), STARTER],
      { cwd: ROOT, encoding: 'utf8' });
    if (nc.status !== 0) failures.push(`new-client failed: ${(nc.stdout + nc.stderr).trim()}`);
    else {
      const starter = readContent(STARTER);
      for (const p of starter.pages) {
        for (const b of p.blocks) {
          if (b.fields.hidden !== false) failures.push(`starter block "${b.id}" is not seeded with hidden: false`);
        }
      }
    }

    // (b) The edit map reports the flag as block metadata, never a scalar
    //     (a scalar would demand an on-page annotation no renderer emits).
    const content = readContent('example-restaurant');
    const map = buildEditMap(content, loadTokens(content));
    for (const page of map.pages) {
      for (const b of page.blocks) {
        if (b.scalars.some(s => s.field === 'hidden')) failures.push(`edit map lists hidden as a scalar on "${b.id}"`);
        if (typeof b.hidden !== 'boolean') failures.push(`edit map does not report block-level hidden state on "${b.id}"`);
      }
    }

    // (c) Toggle round-trip through applyPatch with boolean values: hide →
    //     absent from live HTML but present, annotated, and badged in the
    //     preview build → show → back in live HTML.
    const hide = applyPatch(content, { action: 'set', block: 'home-hero', field: 'hidden', value: true });
    if (!hide.ok) failures.push(`boolean hide rejected: ${hide.error}`);
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    const b1 = build(CLIENT);
    if (!b1.ok) failures.push(`live build with a hidden block failed:\n${b1.out}`);
    const live1 = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
    if (live1.includes(HERO_TEXT)) failures.push('hidden block still present in live HTML');
    if (live1.includes('data-bk-hidden')) failures.push('live HTML carries the data-bk-hidden marker');
    const b2 = build(CLIENT, ['--annotate']);
    if (!b2.ok) failures.push(`annotated build with a hidden block failed:\n${b2.out}`);
    const ann = fs.readFileSync(path.join(ROOT, 'dist', CLIENT + '__annotated', 'index.html'), 'utf8');
    if (!ann.includes(HERO_TEXT)) failures.push('hidden block missing from the annotated preview — the owner could never unhide it');
    if (!ann.includes('data-bk-hidden="true"')) failures.push('annotated preview does not mark the hidden block');
    if (!ann.includes('data-bk-block="home-hero"')) failures.push('hidden block lost its click-to-edit annotations');
    // The overlay's unhide reachability (a click anywhere in a hidden section —
    // dead space or the badge — resolves to that block's editor, so the owner
    // never needs "Discard all" to escape a section they just hid) depends on a
    // structural contract: the data-bk-hidden root must CONTAIN a data-bk-block
    // descendant for the same block. The overlay's per-event DOM resolution is
    // browser-only (manual check), but this precondition is testable here.
    const heroSection = ann.match(/<section\b[^>]*\bdata-bk-hidden="true"[^>]*>([\s\S]*?)<\/section>/);
    if (!heroSection || !heroSection[1].includes('data-bk-block="home-hero"')) {
      failures.push('the hidden section does not contain its own data-bk-block — the overlay could not resolve a click in its dead space to the unhide toggle');
    }

    const show = applyPatch(content, { action: 'set', block: 'home-hero', field: 'hidden', value: false });
    if (!show.ok) failures.push(`boolean show rejected: ${show.error}`);
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    const b3 = build(CLIENT);
    if (!b3.ok) failures.push(`live rebuild after unhiding failed:\n${b3.out}`);
    if (!fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8').includes(HERO_TEXT)) {
      failures.push('unhidden block did not return to live HTML');
    }

    // (d) Type preservation holds both ways, and booleans never enter
    //     lists; every rejection leaves the content untouched.
    const guarded = readContent('example-contractor');
    const orig = JSON.stringify(guarded);
    const gs = [
      ['string onto the boolean flag', applyPatch(guarded, { action: 'set', block: 'home-hero', field: 'hidden', value: 'yes' })],
      ['boolean onto a string field', applyPatch(guarded, { action: 'set', block: 'home-hero', field: 'headline', value: true })],
      ['boolean into a list (match form)', applyPatch(guarded, { action: 'set', block: 'about-values', field: 'items', match: 'anything', value: true })],
      ['boolean appended to a list', applyPatch(guarded, { action: 'append', block: 'about-values', field: 'items', value: false })],
    ];
    for (const [label, r] of gs) {
      if (r.ok) failures.push(`accepted what must be rejected: ${label}`);
    }
    if (JSON.stringify(guarded) !== orig) failures.push('a rejected boolean write modified the content');

    // (e) Absent flag means visible — pre-flag content behaves exactly as
    //     before (the schema change is additive and optional).
    delete content.pages[0].blocks[0].fields.hidden;
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    const b4 = build(CLIENT);
    if (!b4.ok) failures.push(`build without the flag failed (it must stay optional):\n${b4.out}`);
    if (!fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8').includes(HERO_TEXT)) {
      failures.push('a block without the flag was not rendered (absent must mean visible)');
    }
    const mapNoFlag = buildEditMap(JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8')));
    const heroDesc = mapNoFlag.pages[0].blocks[0];
    if (heroDesc.hidden !== null) failures.push('edit map should report hidden: null when the flag is not seeded');

    // (f) The migration script is idempotent and seeds exactly the
    //     flag-less blocks.
    const mig1 = spawnSync(process.execPath, [path.join(ROOT, 'extras', 'add-hidden-flags.js'), CLIENT],
      { cwd: ROOT, encoding: 'utf8' });
    const after = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
    if (mig1.status !== 0 || after.pages[0].blocks[0].fields.hidden !== false) {
      failures.push('add-hidden-flags.js did not seed the missing flag');
    }
    const beforeText = fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8');
    spawnSync(process.execPath, [path.join(ROOT, 'extras', 'add-hidden-flags.js'), CLIENT], { cwd: ROOT, encoding: 'utf8' });
    if (fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8') !== beforeText) {
      failures.push('add-hidden-flags.js is not idempotent');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(path.join(ROOT, 'clients', STARTER), { recursive: true, force: true });
    fs.rmSync(liveDir, { recursive: true, force: true });
    for (const d of [STARTER, CLIENT, CLIENT + '__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — the flag is seeded on every example-client and starter block; the edit');
    console.log('       map reports it as block metadata (never a scalar); a hidden block leaves');
    console.log('       live HTML entirely but stays rendered, annotated, and data-bk-hidden-');
    console.log('       marked in the preview; the toggle round-trips through applyPatch with');
    console.log('       booleans; type preservation rejects strings-on-flag, booleans-on-text,');
    console.log('       and booleans-into-lists with nothing written; an absent flag means');
    console.log('       visible; the migration script seeds it once, idempotently.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 18 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 18 — One session, one commit: publish batches the session; restore reverts it whole ═══');
{
  // Publish (git mode) and restore are git operations on whatever repository
  // contains the engine, so exercising them against THIS repo would write
  // commits into the developer's history. Instead the proof copies the
  // engine into a throwaway git repository under dist/, wires it to a local
  // bare "origin", and drives a real multi-change session there — owner.js
  // resolves every path from its own location, so the copy operates entirely
  // inside the sandbox.
  const SANDBOX = path.join(ROOT, 'dist', '__proof-session-repo');
  const ORIGIN  = path.join(ROOT, 'dist', '__proof-session-origin.git');
  const CLIENT  = 'proof-session';
  const failures = [];

  const sgit = args => spawnSync('git', args, { cwd: SANDBOX, encoding: 'utf8' });

  try {
    const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
    if (probe.error) {
      failures.push('git is required for this proof — publish (git mode) and restore are git operations');
    } else {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
      fs.rmSync(ORIGIN, { recursive: true, force: true });
      fs.mkdirSync(SANDBOX, { recursive: true });
      for (const dir of ['engine', 'themes', 'blueprints']) {
        fs.cpSync(path.join(ROOT, dir), path.join(SANDBOX, dir), { recursive: true });
      }
      const liveDir = path.join(SANDBOX, 'clients', CLIENT);
      fs.mkdirSync(liveDir, { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
        path.join(liveDir, 'content.json'));
      // No "publish" key: the DEFAULT git mode is exactly what is on trial.
      fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
        JSON.stringify({ clientName: 'Proof Client' }) + '\n', 'utf8');

      spawnSync('git', ['init', '--bare', ORIGIN], { encoding: 'utf8' });
      sgit(['init']);
      sgit(['config', 'user.email', 'proof@example.invalid']);
      sgit(['config', 'user.name', 'Proof Runner']);
      // Byte-exactness is part of what is on trial: the revert must restore
      // content.json exactly, so checkout must never rewrite line endings.
      sgit(['config', 'core.autocrlf', 'false']);
      sgit(['add', '-A']);
      sgit(['commit', '-m', 'initial']);
      sgit(['branch', '-M', 'main']);
      sgit(['remote', 'add', 'origin', ORIGIN]);
      sgit(['push', '-u', 'origin', 'main']);

      const preSession = fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8');
      const commitCount = () => Number((sgit(['rev-list', '--count', 'HEAD']).stdout || '').trim());
      const baseCount = commitCount();

      const owner = require(path.join(SANDBOX, 'engine', 'lib', 'owner.js'));
      const session = owner.createSession(CLIENT);

      // (a) A two-change session: keeping never touches git.
      const e1 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: 'Session headline.' });
      if (!e1.ok) failures.push(`edit 1 failed: ${e1.error}`);
      const k1 = owner.keep(session);
      const e2 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'subhead', value: 'Session subhead.' });
      if (!e2.ok) failures.push(`edit 2 failed: ${e2.error}`);
      const k2 = owner.keep(session);
      if (!k1.ok || !k2.ok) failures.push('keep failed in the sandbox session');
      if (commitCount() !== baseCount) failures.push('keeping changes touched git');

      // (b) Publish: the whole session lands as exactly ONE commit carrying
      //     the [blockson-publish <client>] marker, pushed to origin.
      const pub = owner.publish(session);
      if (!pub.ok || !pub.publish.ok) {
        failures.push(`publish failed: ${pub.ok ? pub.publish.message : pub.error}`);
      }
      if (commitCount() !== baseCount + 1) {
        failures.push(`expected exactly one publish commit, got ${commitCount() - baseCount}`);
      }
      const msg = (sgit(['log', '-n', '1', '--format=%B']).stdout || '');
      if (!msg.includes(`[blockson-publish ${CLIENT}]`)) failures.push(`publish commit is missing the marker: ${msg.trim()}`);
      if (!msg.includes('2 changes')) failures.push(`publish message does not summarize the session: ${msg.trim()}`);
      const livePub = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if (livePub.pages[0].blocks[0].fields.headline !== 'Session headline.'
          || livePub.pages[0].blocks[0].fields.subhead !== 'Session subhead.') {
        failures.push('publish did not write the whole session to live');
      }
      // Ask the bare origin for the "main" tip explicitly — its HEAD may
      // still point at the host's default branch name.
      const originHead = spawnSync('git', ['--git-dir', ORIGIN, 'log', '-n', '1', '--format=%B', 'main'], { encoding: 'utf8' });
      if (!(originHead.stdout || '').includes(`[blockson-publish ${CLIENT}]`)) {
        failures.push('the publish commit was not pushed to origin');
      }

      // (c) Restore refuses while changes are staged; once the session is
      //     clear it reverts the WHOLE publish as one unit and republishes.
      const e3 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: 'Stray edit.' });
      if (!e3.ok) failures.push(`edit 3 failed: ${e3.error}`);
      owner.keep(session);
      const blocked = owner.restore(session);
      if (blocked.ok) failures.push('restore ran with staged changes in the session');
      owner.discardAll(session);

      const res = owner.restore(session);
      if (!res.ok) failures.push(`restore failed: ${res.error}`);
      else if (!res.publish.ok) failures.push(`restore could not republish: ${res.publish.message}`);
      if (fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8') !== preSession) {
        failures.push('restore did not revert the whole session as one unit');
      }
      if (commitCount() !== baseCount + 2) {
        failures.push(`restore should add exactly one revert commit (have ${commitCount() - baseCount - 1})`);
      }

      // (d) If the local save/commit succeeds but the outward push fails, the
      //     editor keeps a retryable "waiting publish" state. Retrying should
      //     only push the already-created local commit, not recreate the
      //     session.
      const e4 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: 'Retry headline.' });
      if (!e4.ok) failures.push(`edit 4 failed: ${e4.error}`);
      owner.keep(session);
      sgit(['remote', 'set-url', 'origin', path.join(ROOT, 'dist', '__proof-missing-origin.git')]);
      const failedPush = owner.publish(session);
      if (!failedPush.ok) failures.push(`publish-with-broken-remote failed before local save: ${failedPush.error}`);
      else if (failedPush.publish.ok) failures.push('publish unexpectedly pushed through a broken remote');
      else if (!failedPush.publish.retryable) failures.push('push failure did not mark the publish retryable');
      const waiting = owner.getState(session).lastPublish;
      if (!waiting || !waiting.retryable) failures.push('state does not expose the waiting publish retry affordance');
      if (session.staged.length !== 0) failures.push('retryable publish left the staged session unconsumed after live save');
      if (commitCount() !== baseCount + 3) failures.push(`retryable publish should create one local commit (have ${commitCount() - baseCount})`);

      sgit(['remote', 'set-url', 'origin', ORIGIN]);
      const retry = owner.retryPublish(session);
      if (!retry.ok || !retry.publish.ok) failures.push(`retry publish failed after restoring origin: ${retry.ok ? retry.publish.message : retry.error}`);
      const afterRetry = owner.getState(session).lastPublish;
      if (!afterRetry || afterRetry.retryable) failures.push('successful retry left the retry affordance visible');
      const retryOrigin = spawnSync('git', ['--git-dir', ORIGIN, 'show', `main:clients/${CLIENT}/content.json`], { encoding: 'utf8' });
      if (!(retryOrigin.stdout || '').includes('Retry headline.')) {
        failures.push('retry publish did not push the waiting local commit to origin');
      }
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    fs.rmSync(ORIGIN, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — in a sandbox git repository with a local bare origin: keeping changes');
    console.log('       never touches git; publishing a two-change session makes exactly ONE');
    console.log('       pushed commit carrying the [blockson-publish] marker and the session');
    console.log('       summary; restore refuses while changes are staged and, once clear,');
    console.log('       reverts the whole session as one unit and republishes; a failed outward');
    console.log('       push leaves a retryable waiting publish that succeeds once origin works.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 19 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 19 — Item blueprints: owners add and remove repeating items through the scaffolder ═══');
{
  const scaffold = require('./lib/scaffold');
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-items';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const candIndexPath = path.join(ROOT, 'dist', CLIENT + '__candidate__annotated', 'index.html');
  const ledgerFile = path.join(liveDir, 'edits.log.jsonl');
  const badFile = path.join(ROOT, 'dist', '__proof-bad-item-blueprint.json');
  const failures = [];

  try {
    // (a) Registry: these five item blueprints load and validate (the sixth,
    //     cta-button, is covered in full by proof 27).
    const reg = scaffold.loadBlueprints();
    const bp = key => (reg.blueprints.find(b => b.key === key) || {}).blueprint;
    for (const want of ['card-grid-card', 'faq-pair', 'testimonial-quote', 'team-member', 'gallery-album']) {
      if (!bp(want)) failures.push(`registry is missing item blueprint "${want}"`);
      else if (bp(want).kind !== 'item') failures.push(`"${want}" is not kind "item"`);
    }

    // (b) A valid add lands in the NAMED block with a unique item id;
    //     nothing else in the content moves.
    const content = readContent('example-restaurant');
    const faqItems = content.pages[1].blocks.find(b => b.id === 'menu-faq').fields.items;
    const faqBefore = faqItems.length;
    const r1 = scaffold.instantiate(content, bp('faq-pair'), 'standard',
      { question: 'Do you take large groups?', answer: 'Yes — parties up to twenty with a day\'s notice.' },
      { targetBlock: 'menu-faq' });
    if (!r1.ok) failures.push(`valid item add failed: ${r1.errors.join('; ')}`);
    else {
      if (r1.created.kind !== 'item' || r1.created.blockId !== 'menu-faq' || r1.created.file !== 'menu.html') {
        failures.push(`created record wrong: ${JSON.stringify(r1.created)}`);
      }
      const added = faqItems[faqItems.length - 1];
      if (faqItems.length !== faqBefore + 1 || added.id !== r1.created.itemId
          || added.question !== 'Do you take large groups?') {
        failures.push('the item did not land in the addressed block with the generated id');
      }
    }

    //     Id uniqueness under repeated instantiation, site-wide.
    for (let i = 0; i < 8; i++) {
      const r = scaffold.instantiate(content, bp('faq-pair'), 'standard',
        { question: `Repeat ${i}?`, answer: 'An answer.' }, { targetBlock: 'menu-faq' });
      if (!r.ok) { failures.push(`repeat add ${i} failed: ${r.errors.join('; ')}`); break; }
    }
    const allIds = [];
    for (const p of content.pages) for (const b of p.blocks) {
      allIds.push(b.id);
      (function walk(n) {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === 'object') { if (typeof n.id === 'string') allIds.push(n.id); Object.keys(n).forEach(k => walk(n[k])); }
      })(b.fields);
    }
    if (new Set(allIds).size !== allIds.length) failures.push('item ids collided under repeated instantiation');

    //     …and the full build accepts the result.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    const b1 = build(CLIENT);
    if (!b1.ok) failures.push(`full build rejected the added items:\n${b1.out}`);
    fs.rmSync(liveDir, { recursive: true, force: true });

    // (c) Invalid inputs and targets: rejected by name, nothing written.
    const c2 = readContent('example-restaurant');
    const orig2 = JSON.stringify(c2);
    const goodVals = { question: 'A question?', answer: 'An answer.' };
    const rejects = [
      ['missing required input', scaffold.instantiate(c2, bp('faq-pair'), 'standard', { question: 'Q?' }, { targetBlock: 'menu-faq' })],
      ['over-length input', scaffold.instantiate(c2, bp('faq-pair'), 'standard', { ...goodVals, question: 'x'.repeat(150) }, { targetBlock: 'menu-faq' })],
      ['undeclared value key', scaffold.instantiate(c2, bp('faq-pair'), 'standard', { ...goodVals, hack: 'x' }, { targetBlock: 'menu-faq' })],
      ['unknown target block', scaffold.instantiate(c2, bp('faq-pair'), 'standard', goodVals, { targetBlock: 'no-such-block' })],
      ['wrong target block type', scaffold.instantiate(c2, bp('faq-pair'), 'standard', goodVals, { targetBlock: 'home-team' })],
      ['unknown variant', scaffold.instantiate(c2, bp('faq-pair'), 'fancy', goodVals, { targetBlock: 'menu-faq' })],
    ];
    for (const [label, r] of rejects) {
      if (r.ok) failures.push(`accepted what should be rejected: ${label}`);
    }
    if (JSON.stringify(c2) !== orig2) failures.push('a rejected item add modified the content');

    // (d) removeItem deletes exactly the addressed item; the last item and
    //     un-blessed arrays are refused with nothing written.
    const c3 = readContent('example-restaurant');
    const rm = scaffold.removeItem(c3, { block: 'home-team', item: 'member-sous' });
    const members = c3.pages[0].blocks.find(b => b.id === 'home-team').fields.members;
    if (!rm.ok) failures.push(`remove failed: ${rm.errors.join('; ')}`);
    else {
      if (rm.removed.item.id !== 'member-sous' || rm.removed.field !== 'members') {
        failures.push(`removed record wrong: ${JSON.stringify(rm.removed)}`);
      }
      if (members.length !== 2 || members.some(m => m.id === 'member-sous')) {
        failures.push('remove did not delete exactly the addressed item');
      }
    }
    const rmA = scaffold.removeItem(c3, { block: 'home-testimonials', item: 'testi-brunch' });
    const rmB = scaffold.removeItem(c3, { block: 'home-testimonials', item: 'testi-dinner' });
    const quotes = c3.pages[0].blocks.find(b => b.id === 'home-testimonials').fields.quotes;
    if (!rmA.ok) failures.push(`removing one of two quotes failed: ${rmA.errors.join('; ')}`);
    if (rmB.ok || quotes.length !== 1) failures.push('the LAST item in an array was removed — it must be refused');
    const c4 = readContent('example-restaurant');
    const orig4 = JSON.stringify(c4);
    const rmPlan = scaffold.removeItem(c4, { block: 'menu-starters', item: 'plan-soup' });
    const rmInfo = scaffold.removeItem(c4, { block: 'contact-info', item: 'info-email' });
    if (rmPlan.ok || rmInfo.ok) failures.push('an array with no blessed item blueprint allowed a removal');
    if (rmPlan.errors && !/developer/.test(rmPlan.errors.join(' '))) {
      failures.push(`un-blessed removal refusal does not say it is developer work: ${rmPlan.errors}`);
    }
    if (JSON.stringify(c4) !== orig4) failures.push('a refused removal modified the content');

    // (e) Both operations ride the session flow: candidate-only until
    //     publish, kept entries survive a pending-discard replay, live
    //     HTML ships annotation- and id-free, the ledger records both.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
      path.join(liveDir, 'content.json'));
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Proof Client', publish: 'none' }) + '\n', 'utf8');
    const session = owner.createSession(CLIENT);
    const sousName = readContent(CLIENT).pages[0].blocks
      .find(b => b.id === 'home-team').fields.members.find(m => m.id === 'member-sous').name;

    const add = owner.applyScaffold(session, {
      blueprint: 'card-grid-card', variant: 'standard', targetBlock: 'home-offerings',
      values: { title: 'Private dining', body: 'Book the back room for parties of up to twenty.' },
    });
    let itemId = null;
    if (!add.ok) failures.push(`item add through the owner handler failed: ${add.error}`);
    else {
      itemId = add.created.itemId;
      const cand = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
      const live = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      const candCards = cand.pages[0].blocks.find(b => b.id === 'home-offerings').fields.cards;
      const liveCards = live.pages[0].blocks.find(b => b.id === 'home-offerings').fields.cards;
      if (!candCards.some(c => c.id === itemId)) failures.push('the added item is missing from the candidate');
      if (liveCards.some(c => c.id === itemId)) failures.push('LIVE content gained the item before publish');
      if (!fs.readFileSync(candIndexPath, 'utf8').includes(`data-bk-item="${itemId}"`)) {
        failures.push('the added item is not click-to-edit annotated in the candidate preview');
      }
    }
    const interlocked = owner.applyRemoveItem(session, { block: 'home-team', item: 'member-sous' });
    if (interlocked.ok) failures.push('a removal was accepted while a change was pending');
    owner.keep(session);

    const rem = owner.applyRemoveItem(session, { block: 'home-team', item: 'member-sous' });
    if (!rem.ok) failures.push(`remove through the owner handler failed: ${rem.error}`);
    else {
      if (!rem.pending.old || !rem.pending.old.includes(sousName) || rem.pending.new !== null) {
        failures.push(`the removal card does not show the item's current content: ${JSON.stringify(rem.pending)}`);
      }
      const line = fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)).pop();
      if (line.event !== 'remove-item' || line.outcome !== 'ok'
          || !line.request || line.request.item !== 'member-sous') {
        failures.push(`remove-item logged wrong: ${JSON.stringify(line)}`);
      }
    }
    owner.keep(session);

    owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: 'Replay probe' });
    owner.discard(session);
    const replayed = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
    const repCards = replayed.pages[0].blocks.find(b => b.id === 'home-offerings').fields.cards;
    const repMembers = replayed.pages[0].blocks.find(b => b.id === 'home-team').fields.members;
    if (!repCards.some(c => c.id === itemId)) failures.push('the kept item add did not survive a pending-discard replay');
    if (repMembers.some(m => m.id === 'member-sous')) failures.push('the kept removal did not survive a pending-discard replay');
    if (replayed.pages[0].blocks[0].fields.headline === 'Replay probe') failures.push('the discarded edit survived the replay');

    const pub = owner.publish(session);
    if (!pub.ok) failures.push(`publish failed: ${pub.error}`);
    else {
      const live2 = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      const liveCards2 = live2.pages[0].blocks.find(b => b.id === 'home-offerings').fields.cards;
      const liveMembers2 = live2.pages[0].blocks.find(b => b.id === 'home-team').fields.members;
      if (!liveCards2.some(c => c.id === itemId) || liveMembers2.some(m => m.id === 'member-sous')) {
        failures.push('publish did not write both structural changes to live');
      }
      const liveHtml = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      if (!liveHtml.includes('Private dining')) failures.push('live HTML is missing the added item');
      if (liveHtml.includes(sousName)) failures.push('live HTML still shows the removed member');
      if (liveHtml.includes('data-bk-')) failures.push('live HTML contains data-bk-* after publish');
      if (liveHtml.includes(`id="${itemId}"`) || liveHtml.includes(`-item="${itemId}"`)) {
        failures.push(`live HTML leaks the item id "${itemId}"`);
      }
    }
    const unblessed = owner.applyRemoveItem(session, { block: 'menu-starters', item: 'plan-soup' });
    if (unblessed.ok || session.pending) failures.push('an un-blessed removal slipped through the owner handler');

    // (f) A known-bad item blueprint fails the CLI with named reasons.
    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    fs.writeFileSync(badFile, JSON.stringify({
      name: 'Bad item blueprint', purpose: 'Must fail the validator', kind: 'item',
      target: { blockType: 'carousel', field: 'cards', extra: true },
      variants: [{ key: 'only', label: 'Only layout' }],
      inputs: [{ key: 'title', label: 'Title', type: 'text', required: true }],
      template: { only: { id: 'x', type: 'cta', fields: { statement: '{{title}}' } } },
    }, null, 2), 'utf8');
    const badRun = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'validate-blueprint.js'), badFile],
      { cwd: ROOT, encoding: 'utf8' });
    const badOut = (badRun.stdout || '') + (badRun.stderr || '');
    if (badRun.status === 0) failures.push('validate-blueprint PASSED a known-bad item blueprint');
    for (const named of ['unknown block type "carousel"', 'unknown key "extra"', '"type"/"fields" wrapper']) {
      if (!badOut.includes(named)) failures.push(`bad-item-blueprint output does not name the reason: ${named}`);
    }

    // Owner-facing help must not promise structural powers the maintenance tier
    // deliberately withholds. Reordering remains developer work.
    const helpText = fs.readFileSync(path.join(ROOT, 'engine', 'ui', 'help.js'), 'utf8');
    if (/add,\s*edit,\s*remove,\s*reorder/i.test(helpText)) {
      failures.push('help assistant promises owner-side item reordering');
    }
    if (!/Reordering is a developer change/.test(helpText)) {
      failures.push('help assistant does not name reordering as developer work');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(badFile, { force: true });
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(candDir, { recursive: true, force: true });
    for (const d of [CLIENT, CLIENT + '__annotated', CLIENT + '__candidate', CLIENT + '__candidate__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — five item blueprints validate (cta-button is proof 27); a valid add lands in the');
    console.log('       NAMED block with a site-wide-unique item id and the full build accepts');
    console.log('       it; bad inputs, unknown/wrong-type targets reject with nothing written;');
    console.log('       remove deletes exactly the addressed item, refuses the last item and');
    console.log('       every array without a blessed item blueprint; add and remove both ride');
    console.log('       pending → keep → publish (candidate-only until publish, replay-stable,');
    console.log('       ledgered as remove-item) and live HTML ships with no annotations and no');
    console.log('       item ids; a known-bad item blueprint fails the CLI with named reasons.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 20 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 20 — page-header background inherits the site hero image when omitted ═══');
{
  const CLIENT  = '__proof-page-header-bg';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];

  // The inline background-image url on a built page's page-header band, or null
  // when no inline style is present (i.e. it would defer to the theme CSS).
  const headerBg = (slug) => {
    const html = fs.readFileSync(path.join(distDir, pageFile(slug)), 'utf8');
    const m = html.match(/class="page-header-bg[^"]*"[^>]*style="background-image:url\('([^']*)'\)"/);
    return m ? m[1] : null;
  };
  const hasHeader = (slug) =>
    fs.readFileSync(path.join(distDir, pageFile(slug)), 'utf8').includes('class="page-header-bg');

  try {
    // Base: example-contractor — its index hero is the only background, and its
    // four interior pages carry page-headers that OMIT background. Rename the
    // hero so it is NOT banner.jpg: this is the exact friction that surfaced on
    // the first live site (a non-.jpg hero left interior headers blank under the
    // old theme-CSS-only banner.jpg fallback, which BLOCK_CATALOG.md never
    // promised — it documents "defaults to the site hero image if omitted").
    const content = readContent('example-contractor');
    const hero = content.pages.find(p => p.slug === 'index').blocks.find(b => b.type === 'hero');
    hero.fields.background = 'img/banner.avif';

    // (a) One interior page-header gets an EXPLICIT background; it must win over
    //     the inherited hero. The other three stay omitted and must inherit it.
    const about = content.pages.find(p => p.slug === 'about').blocks.find(b => b.type === 'page-header');
    about.fields.background = 'img/about-banner.avif';

    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    let b = build(CLIENT);
    if (!b.ok) failures.push(`build failed:\n${b.out}`);
    else {
      for (const slug of ['services', 'gallery', 'contact']) {
        const bg = headerBg(slug);
        if (bg !== 'img/banner.avif') {
          failures.push(`${slug} page-header did not inherit the hero image (got ${bg === null ? 'no inline background' : `"${bg}"`})`);
        }
      }
      if (headerBg('about') !== 'img/about-banner.avif') {
        failures.push(`an explicit page-header background was overwritten by the inherited hero (got ${headerBg('about')})`);
      }
    }

    // (b) Last-ditch path: remove the hero entirely so there is NO hero image
    //     anywhere. An omitted page-header background then emits no inline style
    //     and defers to the theme CSS — unchanged behavior for a heroless site.
    const indexPage = content.pages.find(p => p.slug === 'index');
    indexPage.blocks = indexPage.blocks.filter(bl => bl.type !== 'hero');
    delete about.fields.background;
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    b = build(CLIENT);
    if (!b.ok) failures.push(`no-hero build failed:\n${b.out}`);
    else {
      if (!hasHeader('services')) failures.push('the no-hero build lost its page-header element entirely');
      if (headerBg('services') !== null) {
        failures.push(`with no hero, the page-header still emitted an inline background ("${headerBg('services')}") instead of deferring to CSS`);
      }
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — a page-header with no background of its own inherits the site hero image');
    console.log('       even when the hero is not named banner.jpg; an explicit page-header');
    console.log('       background still wins; and a site with no hero at all emits no inline');
    console.log('       background, leaving the theme CSS as the last-ditch fallback.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 21 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 21 — Header focal-point + zoom (hero + page-header): guarded values round-trip; bad values bounce ═══');
{
  const CLIENT  = '__proof-hero-focal';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const PH_CLIENT  = '__proof-pageheader-focal';
  const phLiveDir  = path.join(ROOT, 'clients', PH_CLIENT);
  const failures = [];
  const heroBg = (html) => {
    const m = html.match(/<div class="hero-bg"[^>]*\bstyle="([^"]*)"/);
    return m ? m[1].replace(/&#39;|&apos;/g, "'") : null;
  };
  const pageHeaderBg = (html) => {
    const m = html.match(/<div class="page-header-bg[^"]*"[^>]*\bstyle="([^"]*)"/);
    return m ? m[1].replace(/&#39;|&apos;/g, "'") : null;
  };
  const pageHeaderBgRaw = (html) => {
    // The full opening tag of the first .page-header-bg — used to assert the
    // ABSENCE of an inline style (and of any annotation) on the default paint.
    const m = html.match(/<div class="page-header-bg[^"]*"[^>]*>/);
    return m ? m[0] : null;
  };

  try {
    // (a) Every malformed / out-of-range value is refused, and each rejection
    //     leaves the content byte-identical — no raw CSS can pass the guard.
    const content = readContent('example-contractor');
    const hero = content.pages.find(p => p.slug === 'index').blocks.find(b => b.type === 'hero');
    if (typeof hero.fields.bgPosition !== 'string' || typeof hero.fields.bgZoom !== 'number') {
      failures.push('example-contractor hero is not seeded with bgPosition/bgZoom');
    }
    const orig = JSON.stringify(content);
    const bad = [
      ['position out of range',  { action: 'set', block: hero.id, field: 'bgPosition', value: '110% 50%' }],
      ['position raw CSS',       { action: 'set', block: hero.id, field: 'bgPosition', value: "50% 50%;}body{display:none" }],
      ['position url()',         { action: 'set', block: hero.id, field: 'bgPosition', value: 'url(evil)' }],
      ['zoom too large',         { action: 'set', block: hero.id, field: 'bgZoom', value: 9 }],
      ['zoom too small',         { action: 'set', block: hero.id, field: 'bgZoom', value: 0.5 }],
      ['zoom non-numeric',       { action: 'set', block: hero.id, field: 'bgZoom', value: 'huge' }],
    ];
    for (const [label, patch] of bad) {
      const r = applyPatch(content, patch);
      if (r.ok) failures.push(`accepted what must be rejected: ${label}`);
    }
    if (JSON.stringify(content) !== orig) failures.push('a rejected focal/zoom write modified the content');

    // (b) A valid pair round-trips through applyPatch, persists, and reaches
    //     the BUILT hero as inline background-position + transform:scale; the
    //     live HTML carries only that inline style (no ids, no data-bk-*).
    const okPos = applyPatch(content, { action: 'set', block: hero.id, field: 'bgPosition', value: '20% 80%' });
    const okZoom = applyPatch(content, { action: 'set', block: hero.id, field: 'bgZoom', value: '2' }); // numeric string
    if (!okPos.ok || !okZoom.ok) failures.push(`a valid focal/zoom set was rejected: ${okPos.error || okZoom.error}`);
    if (hero.fields.bgPosition !== '20% 80%') failures.push(`bgPosition did not persist: ${hero.fields.bgPosition}`);
    if (hero.fields.bgZoom !== 2) failures.push(`bgZoom did not normalize to the number 2 (got ${typeof hero.fields.bgZoom} ${hero.fields.bgZoom})`);

    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    const bLive = build(CLIENT);
    if (!bLive.ok) failures.push(`live build with focal/zoom failed:\n${bLive.out}`);
    else {
      const html = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      const style = heroBg(html);
      if (!style || !style.includes('background-position:20% 80%')) failures.push(`built hero is missing the focal point (style="${style}")`);
      if (!style || !/transform:scale\(2\)/.test(style)) failures.push(`built hero is missing the zoom transform (style="${style}")`);
      if (html.includes('data-bk-')) failures.push('live hero HTML carries data-bk-* — focal/zoom must be plain inline style');
      if (html.includes('id="home-hero"')) failures.push('live hero HTML leaks a block id');
    }

    // (c) The build's schema gate accepts the result (a string zoom would have
    //     failed it — the normalization in (b) is what keeps the build clean).
    const bAnn = build(CLIENT, ['--annotate']);
    if (!bAnn.ok) failures.push(`annotated build with focal/zoom failed:\n${bAnn.out}`);

    // (d) The fields are OPTIONAL: a hero without them builds and paints the
    //     default (background-position:50% 50%, scale(1)) — backward compatible.
    delete hero.fields.bgPosition;
    delete hero.fields.bgZoom;
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    const bDefault = build(CLIENT);
    if (!bDefault.ok) failures.push(`build without focal/zoom failed (they must stay optional):\n${bDefault.out}`);
    else {
      const style = heroBg(fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8'));
      if (!style || !style.includes('background-position:50% 50%') || !/transform:scale\(1\)/.test(style)) {
        failures.push(`absent fields did not default to centre/no-zoom (style="${style}")`);
      }
    }

    // (e) The edit map reports the fields as block metadata, never scalars —
    //     so proof 1 demands no annotation no renderer emits (kept in sync by
    //     construction with the annotator).
    const seeded = readContent('example-contractor'); // fields present again
    const map = buildEditMap(seeded, loadTokens(seeded));
    const heroDesc = map.pages.find(p => p.slug === 'index').blocks.find(b => b.type === 'hero');
    for (const banned of ['bgPosition', 'bgZoom']) {
      if (heroDesc.scalars.some(s => s.field === banned)) failures.push(`edit map lists ${banned} as a scalar (would demand an annotation)`);
    }

    // (f) The page-header shares the SAME path — the feature is keyed on the
    //     `background` field + the fields' presence, never the block type. A
    //     page-header (example-restaurant's menu-header, which carries an
    //     explicit background) gets a valid focal/zoom pair, and the BUILT
    //     header paints it as inline background-position + transform:scale on
    //     .page-header-bg, with no ids and no data-bk-* in the live HTML.
    const phContent = readContent('example-restaurant');
    const phHeader = phContent.pages.find(p => p.slug === 'menu').blocks.find(b => b.type === 'page-header');
    // Seed the optional fields — a developer's job, exactly as with the hero
    // (an un-seeded header exposes no controls and a plain set is refused: the
    // fields aren't creatable, so raw CSS can never appear from nowhere). Once
    // present, the SAME guarded set path adjusts them.
    phHeader.fields.bgPosition = '50% 50%';
    phHeader.fields.bgZoom = 1;
    const phOkPos  = applyPatch(phContent, { action: 'set', block: phHeader.id, field: 'bgPosition', value: '35% 15%' });
    const phOkZoom = applyPatch(phContent, { action: 'set', block: phHeader.id, field: 'bgZoom', value: '1.5' });
    if (!phOkPos.ok || !phOkZoom.ok) failures.push(`a valid page-header focal/zoom set was rejected: ${phOkPos.error || phOkZoom.error}`);
    if (phHeader.fields.bgPosition !== '35% 15%') failures.push(`page-header bgPosition did not persist: ${phHeader.fields.bgPosition}`);
    if (phHeader.fields.bgZoom !== 1.5) failures.push(`page-header bgZoom did not normalize to 1.5 (got ${typeof phHeader.fields.bgZoom} ${phHeader.fields.bgZoom})`);

    fs.rmSync(phLiveDir, { recursive: true, force: true });
    fs.mkdirSync(phLiveDir, { recursive: true });
    fs.writeFileSync(path.join(phLiveDir, 'content.json'), JSON.stringify(phContent, null, 2) + '\n', 'utf8');
    const bPh = build(PH_CLIENT);
    if (!bPh.ok) failures.push(`live page-header build with focal/zoom failed:\n${bPh.out}`);
    else {
      const html = fs.readFileSync(path.join(ROOT, 'dist', PH_CLIENT, 'menu.html'), 'utf8');
      const style = pageHeaderBg(html);
      if (!style || !style.includes('background-position:35% 15%')) failures.push(`built page-header is missing the focal point (style="${style}")`);
      if (!style || !/transform:scale\(1\.5\)/.test(style)) failures.push(`built page-header is missing the zoom transform (style="${style}")`);
      if (!style || !/transform-origin:35% 15%/.test(style)) failures.push(`built page-header is missing transform-origin (style="${style}")`);
      const phTag = pageHeaderBgRaw(html);
      if (phTag && phTag.includes('data-bk-')) failures.push('live page-header HTML carries data-bk-* — focal/zoom must be plain inline style');
    }

    // (g) The fields are OPTIONAL on the page-header too, and ABSENT they leave
    //     the build BYTE-IDENTICAL to before the feature: no inline style at all
    //     on a .page-header-bg whose background falls back to the site hero, and
    //     only background-image when an explicit background is set — exactly
    //     today's markup, so an existing site never drifts.
    delete phHeader.fields.bgPosition;
    delete phHeader.fields.bgZoom;
    fs.writeFileSync(path.join(phLiveDir, 'content.json'), JSON.stringify(phContent, null, 2) + '\n', 'utf8');
    const bPhDefault = build(PH_CLIENT);
    if (!bPhDefault.ok) failures.push(`page-header build without focal/zoom failed (they must stay optional):\n${bPhDefault.out}`);
    else {
      // menu-header carries an explicit background → background-image only, no
      // background-position / transform (the theme CSS's center crop stands).
      const menuStyle = pageHeaderBg(fs.readFileSync(path.join(ROOT, 'dist', PH_CLIENT, 'menu.html'), 'utf8'));
      if (!menuStyle || !/^background-image:url\('[^']*'\)$/.test(menuStyle)) {
        failures.push(`absent page-header fields changed the default paint (style="${menuStyle}")`);
      }
      // contact-header omits its own background → inherits the site hero image,
      // so it emits background-image only (no focal decls) — exactly as before
      // the feature; the inherited-hero path stays just as clean.
      const contactStyle = pageHeaderBg(fs.readFileSync(path.join(ROOT, 'dist', PH_CLIENT, 'contact.html'), 'utf8'));
      if (!contactStyle || !/^background-image:url\('[^']*'\)$/.test(contactStyle)) {
        failures.push(`an inherited-hero page-header changed the default paint with no focal fields (style="${contactStyle}")`);
      }
    }

    // (h) The page-header's focal fields are block metadata in the edit map too,
    //     never scalars — same as the hero, so the annotator demands nothing.
    const phSeeded = readContent('example-restaurant');
    const phSeededHeader = phSeeded.pages.find(p => p.slug === 'menu').blocks.find(b => b.type === 'page-header');
    phSeededHeader.fields.bgPosition = '35% 15%';
    phSeededHeader.fields.bgZoom = 1.5;
    const phMap = buildEditMap(phSeeded, loadTokens(phSeeded));
    const phDesc = phMap.pages.find(p => p.slug === 'menu').blocks.find(b => b.type === 'page-header');
    for (const banned of ['bgPosition', 'bgZoom']) {
      if (phDesc.scalars.some(s => s.field === banned)) failures.push(`edit map lists page-header ${banned} as a scalar (would demand an annotation)`);
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(phLiveDir, { recursive: true, force: true });
    for (const d of [CLIENT, CLIENT + '__annotated', PH_CLIENT, PH_CLIENT + '__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — out-of-range and malformed focal/zoom values (raw CSS, url(), zoom');
    console.log('       9 / 0.5 / non-numeric) are refused with nothing written; a valid pair');
    console.log('       round-trips through applyPatch (a string zoom normalized to a number)');
    console.log('       and reaches the built hero as inline background-position + transform:');
    console.log('       scale, with no ids and no data-bk-* in the live HTML; the fields are');
    console.log('       optional (absent → default paint); and the edit map reports them as');
    console.log('       block metadata, never scalars. The page-header shares the SAME guarded');
    console.log('       path (keyed on the background field, not the block type): a valid pair');
    console.log('       reaches its .page-header-bg as the same inline style, while absent fields');
    console.log('       leave the build byte-identical to before the feature.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 22 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 22 — og:image fallback: per-page image → site hero → logo ═══');
{
  const CLIENT  = '__proof-ogimage';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];

  // The og:image content for a built page, or null if the tag is absent.
  const ogImage = (slug) => {
    const html = fs.readFileSync(path.join(distDir, pageFile(slug)), 'utf8');
    const m = html.match(/<meta property="og:image"\s+content="([^"]*)">/);
    return m ? m[1] : null;
  };
  const writeBuild = (content) => {
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
    return build(CLIENT);
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const base    = readContent('example-contractor'); // index hero = img/banner.jpg
    const baseUrl = base.site.baseUrl;
    const heroUrl = `${baseUrl}/img/banner.jpg`;
    const logoUrl = `${baseUrl}/${base.site.logo.black}`;
    if (base.site.logo.black === 'img/banner.jpg') failures.push('test premise broken: logo equals hero');

    // (a) No per-page ogImage: every page (home AND interior) takes the site
    //     hero photo, not the logo — the whole point of the precedence change.
    let b = writeBuild(clone(base));
    if (!b.ok) failures.push(`base build failed:\n${b.out}`);
    else {
      if (ogImage('index') !== heroUrl) failures.push(`home og:image is "${ogImage('index')}", expected the hero ${heroUrl}`);
      if (ogImage('about') !== heroUrl) failures.push(`interior og:image is "${ogImage('about')}", expected the inherited hero ${heroUrl}`);
      if (ogImage('index') === logoUrl) failures.push('home og:image fell back to the logo while a hero exists');
    }

    // (b) An explicit per-page meta.ogImage wins outright on its page; other
    //     pages still take the hero.
    const withPer = clone(base);
    withPer.pages.find(p => p.slug === 'about').meta.ogImage = 'img/custom-share.jpg';
    b = writeBuild(withPer);
    if (!b.ok) failures.push(`per-page build failed:\n${b.out}`);
    else {
      if (ogImage('about') !== `${baseUrl}/img/custom-share.jpg`) failures.push(`explicit per-page ogImage did not win (got "${ogImage('about')}")`);
      if (ogImage('index') !== heroUrl) failures.push('a per-page ogImage on one page changed another page');
    }

    // (c) Guard: heroImage is a raw hero `background` the schema only types as a
    //     string, so a non-image value must NOT be emitted as a social card —
    //     it falls through to the logo.
    const badHero = clone(base);
    badHero.pages.find(p => p.slug === 'index').blocks.find(bl => bl.type === 'hero').fields.background = 'none';
    b = writeBuild(badHero);
    if (!b.ok) failures.push(`non-image-hero build failed:\n${b.out}`);
    else if (ogImage('index') !== logoUrl) {
      failures.push(`a non-image hero background was used as og:image instead of falling back to the logo (got "${ogImage('index')}")`);
    }

    // (d) No hero anywhere: the logo is the last resort, so the tag is never
    //     missing entirely (ugly, never broken).
    const noHero = clone(base);
    const idx = noHero.pages.find(p => p.slug === 'index');
    idx.blocks = idx.blocks.filter(bl => bl.type !== 'hero');
    b = writeBuild(noHero);
    if (!b.ok) failures.push(`no-hero build failed:\n${b.out}`);
    else if (ogImage('index') !== logoUrl) {
      failures.push(`with no hero, og:image is "${ogImage('index')}", expected the logo ${logoUrl}`);
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — with no per-page image, every page (home and interior) takes the site');
    console.log('       hero as its og:image rather than the logo; an explicit per-page');
    console.log('       meta.ogImage still wins on its page; a non-image hero background is');
    console.log('       guarded and falls through to the logo; and with no hero at all the');
    console.log('       logo is the last resort, so the tag is never broken-missing.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 23 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 23 — Unreferenced-image advisory: orphans named, every channel spared, build still succeeds ═══');
{
  const CLIENT  = '__proof-unref-img';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const imgDir  = path.join(liveDir, 'img');
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(imgDir, { recursive: true });
    const content = readContent('example-contractor');

    // Point the hero at a NON-default name so banner.jpg becomes reachable ONLY
    // through the theme CSS (which hard-codes url('../img/banner.jpg')) — the
    // exact cry-wolf case the check must understand and NOT flag.
    content.pages.find(p => p.slug === 'index').blocks.find(b => b.type === 'hero').fields.background = 'img/hero-photo.jpg';
    // An explicit per-page social card exercises the meta.ogImage channel.
    content.pages.find(p => p.slug === 'about').meta.ogImage = 'img/share-card.jpg';
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');

    // One file reachable through each real channel — none may be flagged.
    const referenced = [
      'hero-photo.jpg',   // content: hero background
      'logo-white.png',   // content: logo.white
      'logo-black.png',   // content: logo.black (and the og:image fallback)
      'favicon.png',      // content: logo.favicon
      'share-card.jpg',   // content: per-page meta.ogImage
      'banner.jpg',       // theme CSS ONLY — the cry-wolf guard
    ];
    // Reachable from nothing — each must be named (a nested one proves the walk
    // recurses into sub-folders).
    const orphans = ['orphan.jpg', 'gallery/extra-shot.png'];
    for (const rel of [...referenced, ...orphans]) {
      fs.mkdirSync(path.dirname(path.join(imgDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(imgDir, rel), Buffer.alloc(64));
    }

    const b = build(CLIENT);
    if (!b.ok) failures.push(`build failed (the advisory must never fail a build):\n${b.out}`);
    if (!/Built \d+ page\(s\)/.test(b.out)) failures.push('normal build output is missing');

    for (const rel of orphans) {
      if (!b.out.includes(`img/${rel} is not referenced`)) failures.push(`orphan not named: img/${rel}\n${b.out}`);
    }
    for (const rel of referenced) {
      if (b.out.includes(`img/${rel} is not referenced`)) failures.push(`cried wolf over a referenced image: img/${rel}`);
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — an image reached by nothing (including a nested one) is named on stderr');
    console.log('       so it can be pruned, while images reached through any channel — content');
    console.log("       fields, the logo/favicon trio, a per-page og-image, or the theme CSS's");
    console.log('       hard-coded banner — are spared, and the build still succeeds (exit 0).');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 24 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 24 — Reachable section backgrounds: data-bk-bg marks hero/header backgrounds in preview, never live ═══');
{
  const CLIENT  = '__proof-bg-reach';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const failures = [];

  // Every opening tag that carries the data-bk-bg marker.
  const markedTags = (html) => html.match(/<[a-zA-Z][^>]*\sdata-bk-bg(?:=""|=|\s|>)[^>]*>/g) || [];

  try {
    // example-restaurant covers both shapes: a hero on the home page and a
    // page-header that sets an EXPLICIT background on the menu page (an
    // omitted-background header inherits the hero and is intentionally not a
    // per-page editable target).
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-restaurant', 'content.json'),
      path.join(liveDir, 'content.json'));

    const bAnn  = build(CLIENT, ['--annotate']);
    const bLive = build(CLIENT);
    if (!bAnn.ok)  failures.push(`annotated build failed:\n${bAnn.out}`);
    if (!bLive.ok) failures.push(`live build failed:\n${bLive.out}`);

    const annDir  = path.join(ROOT, 'dist', CLIENT + '__annotated');
    const liveOut = path.join(ROOT, 'dist', CLIENT);
    const annIndex = fs.readFileSync(path.join(annDir, 'index.html'), 'utf8');
    const annMenu  = fs.readFileSync(path.join(annDir, 'menu.html'), 'utf8');

    // (a) Each background is marked AND paired with its background-field
    //     annotation AND sits as a DIRECT CHILD of its section — the exact
    //     structure overlay.js walks (a marked child of the clicked section).
    if (!/<section class="hero">\s*<div class="hero-bg"[^>]*\sdata-bk-field="background"[^>]*\sdata-bk-bg/.test(annIndex)) {
      failures.push('annotated hero background is not a marked, background-field-annotated direct child of <section class="hero">');
    }
    if (!/<header class="page-header"[^>]*>\s*<div class="page-header-bg[^"]*"[^>]*\sdata-bk-field="background"[^>]*\sdata-bk-bg/.test(annMenu)) {
      failures.push('annotated explicit page-header background is not a marked, background-field-annotated direct child of <header class="page-header">');
    }

    // (b) The marker rides ONLY background fields — never a heading, image, or
    //     any other annotated element (so a dead-space click can't be misrouted).
    for (const file of fs.readdirSync(annDir).filter(f => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(annDir, file), 'utf8');
      for (const tag of markedTags(html)) {
        if (!/\sdata-bk-field="background"/.test(tag)) {
          failures.push(`data-bk-bg on a non-background element in ${file}: ${tag.slice(0, 80)}…`);
        }
      }
    }
    // The home hero must actually be among the marked tags (guards against the
    // check passing vacuously if marking ever silently stopped).
    if (markedTags(annIndex).length === 0) failures.push('no data-bk-bg marker found in the annotated home page');

    // (c) No preview-only attribute leaks into a live build: neither the marker
    //     nor any data-bk-* appears on the shipped backgrounds.
    for (const file of fs.readdirSync(liveOut).filter(f => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(liveOut, file), 'utf8');
      if (html.includes('data-bk-bg')) failures.push(`live ${file} contains the data-bk-bg marker`);
      if (html.includes('data-bk-'))  failures.push(`live ${file} contains data-bk-* (preview-only attributes leaked live)`);
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    for (const d of [CLIENT, CLIENT + '__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — the annotated build marks each behind-content background (hero and');
    console.log('       explicit page-header) with data-bk-bg, paired with its background-field');
    console.log('       annotation, as a direct child of its section; the marker rides only');
    console.log('       background fields; and a live build carries neither the marker nor any');
    console.log('       data-bk-* — the overlay routes a dead-space click to a target the live');
    console.log('       site never exposes.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 25 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 25 — Per-page page-header background: owner can set an image where the header inherits the hero ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-header-bg';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const failures = [];
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  try {
    // example-contractor has a hero on index (so heroImage exists) and interior
    // page-headers that OMIT background (about-header inherits the hero).
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'clients', 'example-contractor', 'content.json'),
      path.join(liveDir, 'content.json'));
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Proof Client', publish: 'none' }) + '\n', 'utf8');

    const content = readContent(CLIENT);
    const header = content.pages.find(p => p.slug === 'about').blocks.find(b => b.type === 'page-header');
    if (!header) failures.push('test premise broken: no about page-header');
    if (header && 'background' in header.fields) failures.push('test premise broken: about-header already sets a background');

    // (a) The edit map exposes background on the omitted-background header.
    const map = buildEditMap(content, loadTokens(content));
    const phDesc = map.pages.find(p => p.slug === 'about').blocks.find(b => b.type === 'page-header');
    if (!phDesc.scalars.some(s => s.field === 'background')) {
      failures.push('edit map does not expose background on a header that omits it');
    }

    // (b) The annotated build marks that header's background (so the overlay can
    //     reach it) even though it's only the inherited hero being painted.
    build(CLIENT, ['--annotate']);
    const annAbout = fs.readFileSync(path.join(ROOT, 'dist', CLIENT + '__annotated', 'about.html'), 'utf8');
    if (!/class="page-header-bg[^"]*"[^>]*\sdata-bk-field="background"[^>]*\sdata-bk-bg/.test(annAbout)) {
      failures.push('annotated omitted-background header is not marked editable (data-bk-field=background + data-bk-bg)');
    }

    // (c) The CREATABLE allowlist is narrow: a page-header background takes an
    //     image-path value (created), but a non-image value, an unrelated new
    //     field, and a background on a NON-header block are all refused — and
    //     every rejection leaves the content byte-identical.
    const orig = JSON.stringify(content);
    const okCreate = applyPatch(JSON.parse(orig), { action: 'set', block: header.id, field: 'background', value: 'img/about-banner.jpg' });
    if (!okCreate.ok || !okCreate.created) failures.push(`creating a header background with an image value failed: ${okCreate.error || 'no created flag'}`);

    const nonHeader = content.pages.flatMap(p => p.blocks).find(b => b.type !== 'page-header' && b.type !== 'hero' && !('background' in (b.fields || {})));
    const rejects = [
      ['non-image value', { action: 'set', block: header.id, field: 'background', value: 'not-an-image' }],
      ['unrelated new field', { action: 'set', block: header.id, field: 'invented', value: 'x' }],
      ['traversal image value', { action: 'set', block: header.id, field: 'background', value: 'img/../../evil.png' }],
    ];
    if (nonHeader) rejects.push(['background on a non-header block', { action: 'set', block: nonHeader.id, field: 'background', value: 'img/x.jpg' }]);
    for (const [label, patch] of rejects) {
      const probe = JSON.parse(orig);
      const r = applyPatch(probe, patch);
      if (r.ok) failures.push(`creation that must be refused was accepted: ${label}`);
      if (JSON.stringify(probe) !== orig) failures.push(`a refused creation (${label}) modified the content`);
    }

    // (d) Through the owner editor: the omitted background opens as an IMAGE
    //     whose current value is the inherited hero; an uploaded image creates
    //     the field candidate-side; publish puts a per-page background live that
    //     OVERRIDES the inherited hero, with no annotations or ids in the HTML.
    const session = owner.createSession(CLIENT);
    const heroBg = content.pages.find(p => p.slug === 'index').blocks.find(b => b.type === 'hero').fields.background;
    const d = owner.describeField(session, { block: header.id, field: 'background' });
    if (!d.ok || d.kind !== 'image') failures.push(`describeField on the omitted background did not return an image editor: ${JSON.stringify(d)}`);
    else if (d.value !== heroBg || !d.inherited) failures.push(`the omitted background's current value should be the inherited hero "${heroBg}" (got "${d.value}", inherited=${d.inherited})`);

    const e = owner.applyEdit(session,
      { action: 'set', block: header.id, field: 'background' },
      { name: 'about header.png', dataBase64: PNG_1PX });
    if (!e.ok) failures.push(`creating the header background through the editor failed: ${e.error}`);
    else {
      const cand = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
      const candHeader = cand.pages.find(p => p.slug === 'about').blocks.find(b => b.type === 'page-header');
      if (candHeader.fields.background !== 'img/about-header.png') failures.push(`candidate header background not created as expected: ${candHeader.fields.background}`);
      const live = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      const liveHeader = live.pages.find(p => p.slug === 'about').blocks.find(b => b.type === 'page-header');
      if ('background' in liveHeader.fields) failures.push('LIVE header gained a background before publish');
    }
    owner.keep(session);
    const pub = owner.publish(session);
    if (!pub.ok) failures.push(`publish failed: ${pub.error}`);
    else {
      const liveAbout = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'about.html'), 'utf8');
      if (!liveAbout.includes("background-image:url('img/about-header.png')")) {
        failures.push('the published per-page header background is not in the live HTML');
      }
      if (liveAbout.includes(`url('${heroBg}')`)) failures.push('the live header still paints the inherited hero instead of the per-page image');
      if (liveAbout.includes('data-bk-')) failures.push('live about page carries data-bk-* after publish');
      if (!fs.existsSync(path.join(ROOT, 'dist', CLIENT, 'img', 'about-header.png'))) failures.push('the uploaded header image was not published to live img/');
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
    console.log('PASS — a page-header that inherits the site hero exposes its background as');
    console.log('       editable (mapped + marked in the annotated build); the patch resolver');
    console.log('       creates it ONLY for a page-header background set to an image path, and');
    console.log('       refuses a non-image value, an unrelated new field, and a background on');
    console.log('       a non-header block with nothing written; the editor opens it as an');
    console.log('       image whose current value is the inherited hero; and a created per-page');
    console.log('       background publishes to live HTML, overriding the hero, with no');
    console.log('       annotations or ids.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 26 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 26 — Section doorway: a section can add the optional text it omits (subtitle), guarded ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-section-doorway';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const failures = [];

  try {
    // example-contractor: a hero on index (subhead is schema-REQUIRED, so it is
    // always present — never creatable) and an about page-header whose subtitle
    // is OPTIONAL. Ensure the header omits it — the dead-end the doorway addresses.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const base = readContent('example-contractor');
    const hero   = base.pages.find(p => p.slug === 'index').blocks.find(b => b.type === 'hero');
    const header = base.pages.find(p => p.slug === 'about').blocks.find(b => b.type === 'page-header');
    if (!hero || !header) failures.push('test premise broken: missing hero or about page-header');
    if (header) delete header.fields.subhead;
    writeContent(CLIENT, base);
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Doorway Proof', publish: 'none' }) + '\n', 'utf8');

    const content = readContent(CLIENT);

    // (a) The edit map surfaces the omitted page-header subtitle as CREATABLE
    //     (not a scalar, so proof 1 never demands an annotation for an element
    //     that isn't rendered). A required hero subhead stays an ordinary scalar
    //     and is never reported creatable.
    const map = buildEditMap(content, loadTokens(content));
    const heroDesc = map.pages.find(p => p.slug === 'index').blocks.find(b => b.id === hero.id);
    const phDesc   = map.pages.find(p => p.slug === 'about').blocks.find(b => b.id === header.id);
    const phSub = (phDesc.creatable || []).find(x => x.field === 'subhead');
    if (!phSub || phSub.kind !== 'text') failures.push('page-header edit map does not report subhead as a creatable text field');
    if ((phDesc.scalars || []).some(s => s.field === 'subhead')) failures.push('an absent page-header subhead was put in scalars (would over-constrain proof 1)');
    if ((heroDesc.creatable || []).some(c => c.field === 'subhead')) failures.push('a required hero subhead was wrongly reported creatable');
    if (!(heroDesc.scalars || []).some(s => s.field === 'subhead')) failures.push('the required hero subhead is not a scalar');
    // The inherited page-header BACKGROUND stays a scalar (whenAbsent:'inherits'),
    // never surfaced as creatable — the prior behaviour is unchanged.
    if (!(phDesc.scalars || []).some(s => s.field === 'background')) failures.push('page-header background no longer exposed as a scalar');
    if ((phDesc.creatable || []).some(c => c.field === 'background')) failures.push('page-header background wrongly surfaced as creatable');
    // Once a subtitle exists, it is an ordinary scalar and no longer creatable.
    const withSub = JSON.parse(JSON.stringify(content));
    withSub.pages.find(p => p.slug === 'about').blocks.find(b => b.id === header.id).fields.subhead = 'Hello';
    const phWith = buildEditMap(withSub, loadTokens(withSub)).pages.find(p => p.slug === 'about').blocks.find(b => b.id === header.id);
    if ((phWith.creatable || []).some(c => c.field === 'subhead')) failures.push('a present subhead is still reported as creatable');
    if (!(phWith.scalars || []).some(s => s.field === 'subhead')) failures.push('a present subhead is not a scalar');

    // (b) The CREATABLE guard is narrow: a page-header subtitle takes a one-line
    //     text value (created), but an over-long value, a control character, a
    //     non-string, an unrelated new field, and a subtitle on a block type NOT
    //     in the allowlist are all refused — each leaving the content untouched.
    const orig = JSON.stringify(content);
    const okCreate = applyPatch(JSON.parse(orig), { action: 'set', block: header.id, field: 'subhead', value: 'Serving the area since 1998.' });
    if (!okCreate.ok || !okCreate.created) failures.push(`creating a page-header subtitle with a text value failed: ${okCreate.error || 'no created flag'}`);

    const other = content.pages.flatMap(p => p.blocks).find(b => b.type !== 'hero' && b.type !== 'page-header' && !('subhead' in (b.fields || {})));
    const rejects = [
      ['over-long value', { action: 'set', block: header.id, field: 'subhead', value: 'x'.repeat(201) }],
      ['control character', { action: 'set', block: header.id, field: 'subhead', value: 'line\nbreak' }],
      ['non-string value', { action: 'set', block: header.id, field: 'subhead', value: 42 }],
      ['unrelated new field', { action: 'set', block: header.id, field: 'invented', value: 'x' }],
    ];
    if (other) rejects.push([`subtitle on a ${other.type} block`, { action: 'set', block: other.id, field: 'subhead', value: 'nope' }]);
    for (const [label, patch] of rejects) {
      const probe = JSON.parse(orig);
      const r = applyPatch(probe, patch);
      if (r.ok) failures.push(`creation that must be refused was accepted: ${label}`);
      if (JSON.stringify(probe) !== orig) failures.push(`a refused creation (${label}) modified the content`);
    }

    // (c) Through the owner editor: the omitted subtitle opens as an EMPTY text
    //     editor flagged creating; describeSection reports the section's settings
    //     + the addable subtitle; an edit creates it candidate-side; publish puts
    //     it live with no annotations or ids.
    const session = owner.createSession(CLIENT);
    const d = owner.describeField(session, { block: header.id, field: 'subhead' });
    if (!d.ok || d.kind !== 'text' || d.value !== '' || !d.creating) failures.push(`describeField on the omitted subtitle did not open an empty creating text editor: ${JSON.stringify(d)}`);

    const sec = owner.describeSection(session, { block: header.id });
    if (!sec.ok) failures.push(`describeSection on the page-header failed: ${sec.error}`);
    else {
      if (sec.type !== 'page-header') failures.push(`describeSection reported the wrong type: ${sec.type}`);
      if (!sec.background) failures.push('describeSection did not report the page-header background setting');
      if (!(sec.addable || []).some(a => a.field === 'subhead')) failures.push('describeSection did not offer to add the subtitle');
    }
    // A hero section: settings present, but nothing to add (subhead required).
    const heroSec = owner.describeSection(session, { block: hero.id });
    if (!heroSec.ok || heroSec.type !== 'hero') failures.push('describeSection on the hero failed');
    else if ((heroSec.addable || []).some(a => a.field === 'subhead')) failures.push('describeSection offered to add a subtitle to a hero that already requires one');
    const secMissing = owner.describeSection(session, { block: 'no-such-block' });
    if (secMissing.ok) failures.push('describeSection accepted an unknown section');

    const e = owner.applyEdit(session, { action: 'set', block: header.id, field: 'subhead', value: 'Serving the area since 1998.' });
    if (!e.ok) failures.push(`creating the page-header subtitle through the editor failed: ${e.error}`);
    else {
      const cand = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
      const candHeader = cand.pages.find(p => p.slug === 'about').blocks.find(b => b.id === header.id);
      if (candHeader.fields.subhead !== 'Serving the area since 1998.') failures.push(`candidate page-header subtitle not created as expected: ${candHeader.fields.subhead}`);
      const live = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      const liveHeader = live.pages.find(p => p.slug === 'about').blocks.find(b => b.id === header.id);
      if ('subhead' in liveHeader.fields) failures.push('LIVE page-header gained a subtitle before publish');
    }
    owner.keep(session);
    const pub = owner.publish(session);
    if (!pub.ok) failures.push(`publish failed: ${pub.error}`);
    else {
      const liveAbout = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'about.html'), 'utf8');
      if (!liveAbout.includes('Serving the area since 1998.')) failures.push('the published page-header subtitle is not in the live HTML');
      if (liveAbout.includes('data-bk-')) failures.push('live about page carries data-bk-* after publish');
      if (liveAbout.includes('bk-section-chip')) failures.push('the section chip leaked into a live build');
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
    console.log('PASS — a page-header that omits its (optional) subtitle surfaces it as a');
    console.log('       CREATABLE text field (never a scalar, so the annotation proof is not over-');
    console.log('       constrained), while a required hero subhead stays an ordinary scalar;');
    console.log('       the resolver creates it ONLY for a one-line text value on');
    console.log('       an allowlisted block, refusing an over-long/control-char/non-string');
    console.log('       value, an unrelated field, and a subtitle on a non-allowlisted block with');
    console.log('       nothing written; the editor opens the omission as an empty text field and');
    console.log('       describeSection offers it alongside the section settings; and a created');
    console.log('       subtitle publishes to live HTML with no annotations or chip leaking in.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 27 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 27 — Editable CTA buttons: id migration, addressable buttons, first-button add, guarded ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-cta-buttons';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const failures = [];

  // Build the throwaway client's live content fresh (example-contractor as a
  // realistic base — a hero on index — with a known actions array). Returns the
  // hero block id. Used to reset live state between phases.
  function setupLive(actions) {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const base = readContent('example-contractor');
    const hero = base.pages.find(p => p.slug === 'index').blocks.find(b => b.type === 'hero');
    hero.fields.actions = JSON.parse(JSON.stringify(actions));
    writeContent(CLIENT, base);
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'CTA Proof', publish: 'none' }) + '\n', 'utf8');
    return hero.id;
  }

  try {
    // ── Phase A: the migration (extras/add-action-ids.js) ───────────────────
    // Two buttons SHARING a label, to exercise slug collision + site-wide
    // uniqueness; one of them id-less so the array starts structural.
    const heroId = setupLive([
      { label: 'Get a Quote', href: 'contact.html', style: 'primary' },
      { label: 'Get a Quote', href: 'tel:5551212',  style: 'secondary' },
    ]);

    // Before migration: id-less actions are STRUCTURAL — not an item set, and the
    // annotated build marks no button (graceful: today's behaviour, no break).
    const pre = readContent(CLIENT);
    const preDesc = buildEditMap(pre, loadTokens(pre)).pages.find(p => p.slug === 'index').blocks.find(b => b.id === heroId);
    if ((preDesc.itemSets || []).some(s => s.field === 'actions')) failures.push('un-migrated (id-less) actions were exposed as an item set');
    build(CLIENT, ['--annotate']);
    const preLiveBuild = (function () { build(CLIENT); return fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8'); })();
    if (/class="btn [^"]*"[^>]*data-bk-item/.test(fs.readFileSync(path.join(ROOT, 'dist', CLIENT + '__annotated', 'index.html'), 'utf8'))) {
      failures.push('an un-migrated hero button carried data-bk-item before migration');
    }

    // Run the REAL migration CLI on this client's content.json.
    const mig1 = spawnSync(process.execPath, [path.join(ROOT, 'extras', 'add-action-ids.js'), path.join('clients', CLIENT, 'content.json')],
      { cwd: ROOT, encoding: 'utf8' });
    if (mig1.status !== 0) failures.push(`add-action-ids.js failed: ${(mig1.stdout + mig1.stderr).trim()}`);
    if (!/seeded an id on 2 hero button/.test(mig1.stdout || '')) failures.push(`migration did not report seeding 2 ids: ${(mig1.stdout || '').trim()}`);

    const migrated = readContent(CLIENT);
    const acts = migrated.pages.find(p => p.slug === 'index').blocks.find(b => b.id === heroId).fields.actions;
    const ids = acts.map(a => a.id);
    if (!ids.every(id => typeof id === 'string' && id)) failures.push(`not every action got a string id: ${JSON.stringify(ids)}`);
    if (ids[0] !== 'get-a-quote') failures.push(`first action id is not slugified from its label: ${ids[0]}`);
    if (ids[0] === ids[1]) failures.push(`duplicate-label buttons got the SAME id (not uniqued): ${JSON.stringify(ids)}`);
    if (!/^get-a-quote-\d+$/.test(ids[1])) failures.push(`the colliding id was not numeric-suffixed: ${ids[1]}`);
    const allIds = [];
    for (const p of migrated.pages) for (const b of p.blocks || []) { allIds.push(b.id); }
    for (const id of ids) if (allIds.includes(id)) failures.push(`an action id collides with a block id: ${id}`);

    // Idempotent: a second run changes nothing and says so.
    const before2 = fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8');
    const mig2 = spawnSync(process.execPath, [path.join(ROOT, 'extras', 'add-action-ids.js'), path.join('clients', CLIENT, 'content.json')],
      { cwd: ROOT, encoding: 'utf8' });
    if (!/already migrated/.test(mig2.stdout || '')) failures.push(`second migration run did not report "already migrated": ${(mig2.stdout || '').trim()}`);
    if (fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8') !== before2) failures.push('a second migration run changed the content (not idempotent)');

    // ── Phase B: addressable buttons; annotated marks each, live carries none ─
    const mDesc = buildEditMap(migrated, loadTokens(migrated)).pages.find(p => p.slug === 'index').blocks.find(b => b.id === heroId);
    const aSet = (mDesc.itemSets || []).find(s => s.field === 'actions');
    if (!aSet) failures.push('migrated actions are not exposed as an item set');
    else if (!aSet.items.every(it => it.fields.length === 1 && it.fields[0] === 'label')) {
      failures.push(`an actions item exposed fields other than [label]: ${JSON.stringify(aSet.items.map(i => i.fields))}`);
    }
    build(CLIENT, ['--annotate']);
    const annIndex = fs.readFileSync(path.join(ROOT, 'dist', CLIENT + '__annotated', 'index.html'), 'utf8');
    for (const id of ids) {
      if (!new RegExp(`data-bk-item="${id}"[^>]*data-bk-field="label"`).test(annIndex)) {
        failures.push(`annotated hero button "${id}" is not marked editable (data-bk-item + data-bk-field=label)`);
      }
    }
    if (/data-bk-field="href"|data-bk-field="style"/.test(annIndex)) failures.push('a button href/style was annotated (only label should be)');
    build(CLIENT);
    const postLiveBuild = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
    if (/data-bk-/.test(postLiveBuild)) failures.push('the live build carries data-bk-* after migration');
    if (postLiveBuild !== preLiveBuild) failures.push('the live build is NOT byte-identical after the id migration (it must be — only label/href/style render)');

    // ── Phase C: edit through the owner item path; build gate + rollback ─────
    let session = owner.createSession(CLIENT);
    const id1 = ids[0], id2 = ids[1];
    const df = owner.describeField(session, { block: heroId, item: id1, field: 'label' });
    if (!df.ok || df.kind !== 'text') failures.push(`describeField on a button label did not open a text editor: ${JSON.stringify(df)}`);
    if (!df.button || df.button.href !== 'contact.html' || df.button.style !== 'primary') failures.push(`the button editor ride-along is missing or wrong: ${JSON.stringify(df.button)}`);
    if (!(df.addable || []).some(a => a.key === 'cta-button')) failures.push('describeField did not offer "Add Button" on a hero button');
    if (!df.itemRemove || !df.itemRemove.allowed) failures.push('a button was not reported removable while two exist');

    function editKeep(patch, label) {
      const r = owner.applyEdit(session, patch);
      if (!r.ok) { failures.push(`${label} failed: ${r.error}`); return; }
      const k = owner.keep(session); if (!k.ok) failures.push(`keep after ${label} failed: ${k.error}`);
    }
    editKeep({ action: 'set', block: heroId, item: id1, field: 'label', value: 'Start Here' }, 'edit button label');
    editKeep({ action: 'set', block: heroId, item: id1, field: 'href',  value: 'https://example.com/start' }, 'edit button link');
    editKeep({ action: 'set', block: heroId, item: id1, field: 'style', value: 'secondary' }, 'change button style');

    // A bad link (fails safeHref) and a bad style (not in the enum) are caught by
    // the candidate BUILD with rollback — the value gate is the schema, exactly
    // as the plan intends. Nothing is left pending and the candidate is unchanged.
    const badHref = owner.applyEdit(session, { action: 'set', block: heroId, item: id1, field: 'href', value: 'javascript:alert(1)' });
    if (badHref.ok || !badHref.buildFailed) failures.push('an unsafe button link was not refused by the build gate');
    const afterBadHref = JSON.parse(fs.readFileSync(path.join(candDir, "content.json"), 'utf8')).pages.find(p => p.slug === 'index').blocks.find(b => b.id === heroId).fields.actions.find(a => a.id === id1);
    if (afterBadHref.href !== 'https://example.com/start') failures.push(`a rejected link edit changed the candidate (href is now ${afterBadHref.href})`);

    const badStyle = owner.applyEdit(session, { action: 'set', block: heroId, item: id1, field: 'style', value: 'ghost' });
    if (badStyle.ok || !badStyle.buildFailed) failures.push('an out-of-enum button style was not refused by the build gate');

    // Remove a button (item path, never applyPatch); the last one is refused.
    const rm = owner.applyRemoveItem(session, { block: heroId, item: id2 });
    if (!rm.ok) failures.push(`removing a button failed: ${rm.error}`);
    else owner.keep(session);
    const rmLast = owner.applyRemoveItem(session, { block: heroId, item: id1 });
    if (rmLast.ok) failures.push('removing the LAST button was allowed (it must be refused)');

    const pub = owner.publish(session);
    if (!pub.ok) failures.push(`publish failed: ${pub.error}`);
    else {
      const liveIndex = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      if (!/<a href="https:\/\/example\.com\/start" class="btn btn-secondary">Start Here<\/a>/.test(liveIndex)) {
        failures.push('the edited button (label/link/style) is not in the published live HTML');
      }
      // Count buttons inside the HERO's own actions row (other sections render
      // their own .btn links — scope the count to the hero).
      const heroActions = (liveIndex.match(/<div class="hero-actions">([\s\S]*?)<\/div>/) || [])[1] || '';
      if ((heroActions.match(/<a /g) || []).length !== 1) failures.push('the published hero does not have exactly one button after the removal');
      if (/data-bk-/.test(liveIndex)) failures.push('published live HTML carries data-bk-*');
    }

    // ── Phase D: add the FIRST button to an EMPTY actions array ──────────────
    // The scaffold relaxation: an absent/empty target array is created by the
    // first item. Reset live with empty actions; the Section panel's addItems
    // is the doorway (no button to click).
    setupLive([]);
    session = owner.createSession(CLIENT);
    const sec = owner.describeSection(session, { block: heroId });
    if (!sec.ok || !(sec.addItems || []).some(a => a.key === 'cta-button')) failures.push('describeSection on a hero with empty actions did not offer to add a button');
    const sc = owner.applyScaffold(session, { blueprint: 'cta-button', variant: 'primary', values: { label: 'Free Estimate', href: '#contact' }, targetBlock: heroId });
    if (!sc.ok) failures.push(`adding the first button failed: ${sc.error}`);
    else if (!sc.created || sc.created.kind !== 'item') failures.push(`the first button was not created as an item: ${JSON.stringify(sc.created)}`);
    if (sc.ok) {
      const candActs = JSON.parse(fs.readFileSync(path.join(candDir, "content.json"), 'utf8')).pages.find(p => p.slug === 'index').blocks.find(b => b.id === heroId).fields.actions;
      if (!Array.isArray(candActs) || candActs.length !== 1) failures.push(`the candidate hero does not have exactly one created button: ${JSON.stringify(candActs)}`);
      else if (typeof candActs[0].id !== 'string' || candActs[0].href !== '#contact' || candActs[0].style !== 'primary') failures.push(`the created button is malformed: ${JSON.stringify(candActs[0])}`);
      const liveActsBefore = readContent(CLIENT).pages.find(p => p.slug === 'index').blocks.find(b => b.id === heroId).fields.actions;
      if (Array.isArray(liveActsBefore) && liveActsBefore.length) failures.push('LIVE hero gained a button before publish');
      owner.keep(session);
      const pub2 = owner.publish(session);
      if (!pub2.ok) failures.push(`publishing the first button failed: ${pub2.error}`);
      else {
        const liveIndex = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
        if (!/<a href="#contact" class="btn btn-primary">Free Estimate<\/a>/.test(liveIndex)) failures.push('the added first button is not in the published live HTML');
        if (/data-bk-/.test(liveIndex)) failures.push('published live HTML (first button) carries data-bk-*');
      }
    }
  } catch (e) {
    failures.push(`exception: ${e.message}\n${e.stack}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(candDir, { recursive: true, force: true });
    for (const d of [CLIENT, CLIENT + '__annotated', CLIENT + '__candidate', CLIENT + '__candidate__annotated']) {
      fs.rmSync(path.join(ROOT, 'dist', d), { recursive: true, force: true });
    }
  }

  if (failures.length === 0) {
    console.log('PASS — extras/add-action-ids.js seeds a slugified, site-wide-unique id on every');
    console.log('       hero button (numeric-suffixed on a label collision) and is a no-op on a');
    console.log('       second run; a migrated hero exposes its actions as an item set whose only');
    console.log('       click field is label (the annotated build marks each button there, never');
    console.log('       its href/style), while the live build stays byte-identical and data-bk-');
    console.log('       free; a button\'s label/link/style each edit through the item path with the');
    console.log('       build as the value gate (an unsafe link and an out-of-enum style are');
    console.log('       rolled back), a button removes via the item path (the last one refused),');
    console.log('       and the scaffold relaxation adds the FIRST button to an empty actions array');
    console.log('       through the Section-panel doorway — candidate-only, then live on publish,');
    console.log('       with no annotations or ids leaking into the live HTML.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 28 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 28 — Host seam: owner handlers drive an in-memory (non-Node) host through edit → keep → discard ═══');
{
  const owner    = require('./lib/owner');
  const validate = require('./lib/validate');
  const scaffold = require('./lib/scaffold');
  const failures = [];

  // Seed fixture: example-restaurant's content, read once from disk (fixture
  // loading only — the host below never touches the filesystem afterwards).
  const seedText = fs.readFileSync(
    path.join(ROOT, 'clients', 'example-restaurant', 'content.json'), 'utf8');
  const tokens = loadTokens(JSON.parse(seedText));

  // Pre-seed the engine's two filesystem reads so validate() + the blueprint
  // registry run with NO fs — exactly what the browser bundle does at startup
  // (validate.setSchema / scaffold.setBlueprintRegistry are the seam hooks the
  // refactor added). Captured first so the finally block can restore the Node
  // path (these are module-level singletons shared with later runs).
  const schema   = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'engine', 'schema', 'content.schema.json'), 'utf8'));
  const registry = scaffold.loadBlueprints();   // real disk scan, captured once
  validate.setSchema(schema);
  scaffold.setBlueprintRegistry(registry);

  try {
    // The seam hooks actually took effect: a dir-less blueprint load now returns
    // the injected registry rather than re-scanning disk.
    if (scaffold.loadBlueprints() !== registry) {
      failures.push('setBlueprintRegistry did not divert the dir-less blueprint load');
    }

    // ── The in-memory host: the SAME interface engine/lib/host-node.js returns,
    //    but content lives in JS strings, images in a Map, the acceptance build
    //    is validate() over the in-memory content (no disk, no spawned build.js),
    //    the ledger is captured to an array, and Publish is a host-level no-op.
    const ledger = [];
    let liveText = seedText;
    let candText = seedText;
    let liveImages = new Map();
    let candImages = new Map();

    const inMemoryBuild = (text) => {
      let content;
      try { content = JSON.parse(text); }
      catch (e) { return { ok: false, out: `content is not valid JSON: ${e.message}` }; }
      const r = validate.validate(content);   // the same schema gate build.js runs
      return r.ok ? { ok: true, out: '' } : { ok: false, out: (r.errors || []).join('\n') };
    };

    const host = {
      config: { clientName: 'In-Memory Client', publish: 'none' },
      readCandidateText: () => candText,
      writeCandidateText: (t) => { candText = t; },
      readLiveText:  () => liveText,
      writeLiveText: (t) => { liveText = t; },
      liveExists: () => true,
      resetCandidateFromLive: () => { candText = liveText; candImages = new Map(liveImages); },
      writeCandidateImage: (name, bytes) => { candImages.set(name, bytes); },
      removeCandidateImage: (name) => { candImages.delete(name); },
      candidateImageExists: (name) => candImages.has(name),
      buildCandidate: () => inMemoryBuild(candText),
      buildLive:      () => inMemoryBuild(liveText),
      presetTokens: () => tokens,
      publishMode: () => 'none',
      ledgerAppend: (entry) => { ledger.push(entry); },
      // Publish disabled by the HOST: report nothing shipped (live:false), which
      // tells owner.publish() to leave the staged session intact — the one and
      // only difference between the demo host and the Node host.
      shipSession: () => ({ ok: true, live: false }),
      restore: () => ({ ok: false, error: 'publishing is disabled on this host' }),
    };

    const session = owner.createSession('__in-memory', null, host);

    // (a) Session start: candidate equals live, and the in-memory acceptance
    //     build accepts the seed content (createSession would have thrown otherwise).
    if (candText !== liveText) failures.push('session did not start with candidate === live');

    // (b) describeField reads the current candidate value through the seam.
    const d = owner.describeField(session, { block: 'home-hero', field: 'headline' });
    if (!d.ok || d.kind !== 'text' || d.value !== 'Comfort food, wood-fired.') {
      failures.push(`describeField wrong on the in-memory host: ${JSON.stringify(d)}`);
    }

    // (c) Edit: candidate-only write; live string untouched; change card derived.
    const NEW = 'Wood-fired, all winter.';
    const e1 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'headline', value: NEW });
    if (!e1.ok) failures.push(`edit failed on the in-memory host: ${e1.error}`);
    else {
      if (e1.pending.old !== 'Comfort food, wood-fired.' || e1.pending.new !== NEW) {
        failures.push(`change card old→new wrong: ${JSON.stringify(e1.pending)}`);
      }
      if (JSON.parse(candText).pages[0].blocks[0].fields.headline !== NEW) failures.push('candidate string was not updated');
      if (JSON.parse(liveText).pages[0].blocks[0].fields.headline === NEW) failures.push('LIVE string was touched before publish');
    }

    // (d) One pending change at a time.
    if (owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'subhead', value: 'x' }).ok) {
      failures.push('a second edit was accepted while one was pending (in-memory host)');
    }

    // (e) Keep stages the card; next edit allowed; second keep extends the list.
    const k1 = owner.keep(session);
    if (!k1.ok || session.pending || k1.staged.length !== 1 || k1.staged[0].new !== NEW) {
      failures.push(`keep did not stage the change card: ${JSON.stringify(k1)}`);
    }
    const NEW2 = 'Open every winter evening.';
    if (!owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'subhead', value: NEW2 }).ok) {
      failures.push('the edit after a keep was refused (in-memory host)');
    }
    if (owner.keep(session).staged.length !== 2) failures.push('the second keep did not extend the staged list');

    // (f) Staged changes survive a pending-discard: the candidate is rebuilt from
    //     live + a REPLAY of the staged list, dropping only the pending change.
    owner.applyEdit(session, { action: 'set', block: 'site', field: 'copyright', value: 'Temporary line.' });
    const disc1 = owner.discard(session);
    if (!disc1.ok) failures.push(`pending-discard failed (in-memory host): ${disc1.error}`);
    const replayed = JSON.parse(candText);
    if (replayed.pages[0].blocks[0].fields.headline !== NEW || replayed.pages[0].blocks[0].fields.subhead !== NEW2) {
      failures.push('a pending-discard disturbed the staged changes on the in-memory host');
    }
    if (replayed.site.copyright === 'Temporary line.') failures.push('the discarded pending change survived the replay');

    // (g) Resolver guards run unchanged on the in-memory path: a forbidden field
    //     and an unsafe token value both bounce, nothing left pending.
    const g1 = owner.applyEdit(session, { action: 'set', block: 'home-hero', field: 'id', value: 'x' });
    const g2 = owner.applyEdit(session, { action: 'set-token', token: '--color-primary', value: 'red;background:url(evil)' });
    if (g1.ok || g2.ok || session.pending) failures.push('a guarded write slipped through on the in-memory host');

    // (h) Publish is a no-op PROPERTY OF THE HOST: with two changes staged,
    //     publish() returns without shipping and the staged session is preserved
    //     (live string never written) — the demo host's only divergence.
    const liveBeforePublish = liveText;
    const pub = owner.publish(session);
    if (!pub.ok) failures.push(`demo publish reported an error: ${pub.error}`);
    if (pub.live) failures.push('the demo host claimed it shipped to live');
    if (session.staged.length !== 2) failures.push('demo publish consumed the staged session');
    if (liveText !== liveBeforePublish) failures.push('demo publish wrote the live string');

    // (i) An uploaded image rides the candidate Map (never the live Map), and
    //     survives the pending-discard replay once kept.
    const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const e5 = owner.applyEdit(session,
      { action: 'set', block: 'home-team', item: 'member-chef', field: 'photo' },
      { name: 'new portrait.png', dataBase64: PNG_1PX });
    if (!e5.ok) failures.push(`image edit failed on the in-memory host: ${e5.error}`);
    else {
      if (e5.pending.new !== 'img/new-portrait.png') failures.push(`image path not assigned by the handler: ${e5.pending.new}`);
      if (!candImages.has('new-portrait.png')) failures.push('uploaded image missing from the candidate Map');
      if (liveImages.has('new-portrait.png')) failures.push('uploaded image leaked into the live Map');
    }
    owner.keep(session);
    owner.applyEdit(session, { action: 'set', block: 'site', field: 'copyright', value: 'Replay check.' });
    owner.discard(session);
    if (!candImages.has('new-portrait.png')) failures.push('a kept upload did not survive the pending-discard replay (in-memory host)');

    // (j) discard-all resets the candidate from live and empties the session —
    //     candidate string and image Map both return to the live baseline.
    const dAll = owner.discardAll(session);
    if (!dAll.ok || candText !== liveText) failures.push('discard-all did not reset the candidate from live (in-memory host)');
    if (candImages.has('new-portrait.png')) failures.push('discard-all left the uploaded image in the candidate Map');
    if (liveImages.has('new-portrait.png')) failures.push('a discarded upload leaked into the live Map');

    // (k) The ledger boundary still fires through the injected sink — one entry
    //     per attempt, with the event + outcome owner.js records on every host.
    if (!ledger.length) failures.push('no ledger entry was appended through the in-memory sink');
    if (!ledger.some(l => l.event === 'edit' && l.outcome === 'ok')) failures.push('the ledger did not capture a successful edit');
    if (!ledger.some(l => l.event === 'keep')) failures.push('the ledger did not capture a keep');
    if (!ledger.some(l => l.event === 'edit' && l.outcome === 'rejected')) failures.push('the ledger did not capture a guarded rejection');
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    // Restore the Node path for any later use of these module singletons.
    scaffold.setBlueprintRegistry(null);
    validate.setSchema(schema);   // the same schema the lazy fs load would cache
  }

  if (failures.length === 0) {
    console.log('PASS — the same owner.js handlers drive a fully in-memory host (content in JS');
    console.log('       strings, images in a Map, the acceptance build = validate() with the');
    console.log('       schema + blueprint registry pre-seeded so NO filesystem is touched)');
    console.log('       through the same edit → keep → second edit → keep → pending-discard');
    console.log('       (replay) → discard-all cycle as the Node path: one pending change at a');
    console.log('       time, kept changes survive the replay, the resolver guards still bounce a');
    console.log('       forbidden field and an unsafe token, an upload rides the candidate Map');
    console.log('       only and survives the replay, the ledger fires one entry per attempt, and');
    console.log('       Publish is a no-op property of the host that leaves the staged session');
    console.log('       intact — the adapter cannot silently diverge from the disk/git host.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 29 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 29 — Heavy-gallery advisory: a photo-laden album gets a soft heads-up, never a cap ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-gallery-weight';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const failures = [];
  // The editor shows the heads-up at this album photo count (mirrors owner.js's
  // GALLERY_PHOTOS_HEAVY_AFTER — bump both together if the threshold is tuned).
  const HEAVY_AFTER = 12;
  const ALBUM = 'album-bathroom';
  const GALLERY = 'gallery-main';
  const REF = { block: GALLERY, item: ALBUM, field: 'images' };

  // Throwaway client = example-contractor's content (a gallery with album-bathroom)
  // with album-bathroom's photo list set to `n` paths. No img/ folder is needed:
  // the advisory is a count of content paths, not of files on disk.
  function setupWithPhotos(n) {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const base = readContent('example-contractor');
    const album = base.pages.flatMap(p => p.blocks)
      .find(b => b.id === GALLERY).fields.albums.find(a => a.id === ALBUM);
    album.images = Array.from({ length: n }, (_, i) => `img/shot-${i + 1}.jpg`);
    writeContent(CLIENT, base);
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Gallery Weight Proof', publish: 'none' }) + '\n', 'utf8');
  }

  try {
    // (a) Just under the threshold: an ordinary image-list editor, no heads-up.
    setupWithPhotos(HEAVY_AFTER - 1);
    const sBelow = owner.createSession(CLIENT);
    const below = owner.describeField(sBelow, REF);
    if (!below.ok || below.kind !== 'image-list') failures.push(`describeField on the album photos did not open an image list: ${JSON.stringify(below)}`);
    if (below.lines.length !== HEAVY_AFTER - 1) failures.push(`wrong photo count below the threshold: ${below.lines.length}`);
    if (below.notice) failures.push(`a below-threshold album wrongly carried the heavy-gallery heads-up: ${below.notice}`);

    // (b) At the threshold: the same image-list editor, now WITH the advisory —
    //     a plain-language, non-empty notice that names the page-load trade-off.
    setupWithPhotos(HEAVY_AFTER);
    const sAt = owner.createSession(CLIENT);
    const at = owner.describeField(sAt, REF);
    if (!at.ok || at.kind !== 'image-list') failures.push(`describeField at the threshold did not open an image list: ${JSON.stringify(at)}`);
    if (at.lines.length !== HEAVY_AFTER) failures.push(`wrong photo count at the threshold: ${at.lines.length}`);
    if (!at.notice) failures.push('an at-threshold album did not carry the heavy-gallery heads-up');
    else if (!/slower to load/.test(at.notice)) failures.push(`the heads-up does not mention the page-load cost: ${at.notice}`);

    // (c) Advisory only — it NEVER blocks the edit. Appending one more photo
    //     past the threshold still succeeds, and the heads-up simply persists.
    const append = owner.applyEdit(sAt,
      { action: 'append', block: GALLERY, item: ALBUM, field: 'images' },
      { name: 'one-more.png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
    if (!append.ok) failures.push(`appending a photo past the heavy threshold was wrongly blocked: ${append.error}`);
    const after = owner.describeField(sAt, REF);
    if (after.ok && after.lines.length !== HEAVY_AFTER + 1) failures.push(`the appended photo did not land: ${after.lines.length}`);
    if (after.ok && !after.notice) failures.push('the heads-up vanished after going further past the threshold');

    // (d) The advisory is scoped to PHOTOS, not lists in general: a flat text
    //     list of the same length (a card's bullet items) never gets it.
    const withList = readContent('example-contractor');
    const card = withList.pages.flatMap(p => p.blocks)
      .find(b => b.id === 'home-services').fields.cards.find(c => c.id === 'card-renovations');
    card.items = Array.from({ length: HEAVY_AFTER + 2 }, (_, i) => `Bullet point ${i + 1}`);
    writeContent(CLIENT, withList);
    const sList = owner.createSession(CLIENT);
    const textList = owner.describeField(sList, { block: 'home-services', item: 'card-renovations', field: 'items' });
    if (!textList.ok || textList.kind !== 'text-list') failures.push(`describeField on the card bullets did not open a text list: ${JSON.stringify(textList)}`);
    if (textList.notice) failures.push(`a long TEXT list wrongly got the heavy-gallery heads-up: ${textList.notice}`);
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
    console.log('PASS — a gallery album under the photo-count threshold opens an ordinary image');
    console.log('       list, an album at/over it carries a plain-language heads-up that names the');
    console.log('       page-load cost, appending one more photo still succeeds (the advisory never');
    console.log('       caps an edit) with the heads-up persisting, and a same-length flat TEXT');
    console.log('       list never gets it — the nudge is scoped to photos, computed in owner.js so');
    console.log('       the Node editor and the browser demo show it identically.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 30 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 30 — Hostile content values render inert in every block type ═══');
{
  const CLIENT  = '__proof-xss';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];

  // One string carrying every breakout an attribute context fears: a bare
  // word + `=` (unquoted-attribute injection), a backtick (legacy unquoted
  // breakout), both quote kinds (quoted-attribute breakout), and a complete
  // element (markup injection). With every interpolation quoted and esc()'d,
  // ALL of it survives only as visible text; any escaping gap surfaces below
  // as a forged attribute or a live <img> probe in the built HTML.
  const PAYLOAD = 'x onmouseover=alert(1) `"\'<img src=x onerror=alert(2)>';

  // Link/path/enum-shaped fields are constrained by the resolver or the
  // schema — a hostile value there is REFUSED, which is its own kind of safe
  // (and proofs 5–7/27 already pin the refusals). This proof targets the
  // fields that ACCEPT free text, because accepted text is what must render
  // inert.
  const SKIP_FIELD = /(^|\.)(href|url|videoUrl|mapEmbedUrl|formAction|successPath|background|image|logo|favicon|ogImage|icon|style|theme|mode|bgPosition|bgZoom|platform|variant|columns|stars)$/i;
  const SKIP_VALUE = /^(img\/|https?:|mailto:|tel:|sms:|#)/i;

  // Attribute NAMES of one opening tag, respecting quoted values (an escaped
  // payload inside quotes is safe text, not an attribute). A forged
  // `onmouseover=alert(1)` that broke out of its context parses as a name
  // here — exactly the failure being hunted.
  const attrNames = (tag) => {
    const names = [];
    const inner = tag.replace(/^<\/?[a-zA-Z][^\s/>]*/, '').replace(/\/?>$/, '');
    const re = /([^\s=/'"`]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
    let m;
    while ((m = re.exec(inner))) {
      if (m[1]) names.push(m[1]);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return names;
  };

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });

    // The blueprint gallery is the committed corpus that instantiates every
    // registered block type — inject through the same edit map + applyPatch
    // path an owner or a model uses, so the proof covers the writable surface
    // as the maintenance tier actually reaches it.
    const content = readContent('blueprint-gallery');
    const map = buildEditMap(content, loadTokens(content));
    const blockById = new Map();
    for (const page of content.pages) for (const b of page.blocks) blockById.set(b.id, b);

    const injectedTypes = new Set();
    let accepted = 0;
    const tryPatch = (blockId, patch) => {
      const r = applyPatch(content, patch);
      if (r.ok) { accepted++; injectedTypes.add(blockById.get(blockId).type); }
    };

    for (const page of map.pages) {
      for (const b of page.blocks) {
        for (const s of b.scalars || []) {
          if (SKIP_FIELD.test(s.field)) continue;
          if (s.preview != null && SKIP_VALUE.test(String(s.preview))) continue;
          tryPatch(b.id, { action: 'set', block: b.id, field: s.field, value: PAYLOAD });
        }
        for (const is of b.itemSets || []) {
          for (const it of is.items || []) {
            for (const f of it.fields || []) {
              if (SKIP_FIELD.test(f)) continue;
              const cur = blockById.get(b.id) && blockById.get(b.id).fields[is.field];
              const item = Array.isArray(cur) && cur.find(x => x.id === it.id);
              if (item && typeof item[f] === 'string' && SKIP_VALUE.test(item[f])) continue;
              tryPatch(b.id, { action: 'set', block: b.id, item: it.id, field: f, value: PAYLOAD });
            }
          }
        }
        for (const tl of b.textLists || []) {
          const arr = blockById.get(b.id) && blockById.get(b.id).fields[tl.field];
          if (!Array.isArray(arr) || !arr.length || typeof arr[0] !== 'string') continue;
          if (SKIP_VALUE.test(arr[0])) continue;
          tryPatch(b.id, { action: 'set', block: b.id, field: tl.field, match: arr[0], value: PAYLOAD });
        }
      }
    }

    writeContent(CLIENT, content);
    const b = build(CLIENT);
    if (!b.ok) failures.push(`the live build refused hostile-but-accepted content — resolver and schema disagree:\n${b.out}`);

    // Coverage: every registered block type must have taken at least one
    // accepted hostile write, or the proof has silently narrowed.
    const registry = Object.keys(require('./blocks/_registry'));
    for (const t of registry) {
      if (!injectedTypes.has(t)) failures.push(`no hostile value was accepted into any "${t}" text field — that block type is no longer covered`);
    }
    if (accepted < registry.length) failures.push(`only ${accepted} hostile writes were accepted — expected at least one per block type`);

    if (b.ok) {
      const files = fs.readdirSync(distDir).filter(f => f.endsWith('.html'));
      if (!files.length) failures.push('the hostile build produced no pages');
      let sawEscaped = false;
      for (const f of files) {
        const html = fs.readFileSync(path.join(distDir, f), 'utf8');
        if (html.includes('<img src=x')) failures.push(`${f}: the payload's <img> probe landed as real markup`);
        if (html.includes('&lt;img src=x onerror=alert(2)&gt;')) sawEscaped = true;
        for (const tag of html.match(/<[a-zA-Z!/][^>]*>/g) || []) {
          for (const name of attrNames(tag)) {
            if (/^on/i.test(name)) failures.push(`${f}: forged event-handler attribute "${name}" in: ${tag.slice(0, 90)}`);
          }
        }
      }
      if (!sawEscaped) failures.push('the escaped payload never appeared in any built page — the injections did not reach rendered output');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — a payload carrying an unquoted-attribute breakout, a backtick, both');
    console.log('       quote kinds, and a full <img onerror> element was accepted into at least');
    console.log('       one free-text field of every registered block type via applyPatch; the');
    console.log('       live build succeeds, no built tag gains an event-handler attribute, the');
    console.log('       <img> probe never lands as markup, and the payload survives only as');
    console.log('       escaped visible text — quoted-and-escaped interpolation, proven at the');
    console.log('       rendered surface rather than by reading the renderers.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.slice(0, 25).forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 31 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 31 — No-AJV fallback: the build still ships, warns loudly, and still guards ═══');
{
  const CLIENT  = '__proof-noajv';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const stubPath = path.join(liveDir, 'no-ajv-stub.js');
  const failures = [];

  const buildNoAjv = () => {
    const r = spawnSync(process.execPath,
      ['--require', stubPath, path.join(__dirname, 'build.js'), CLIENT],
      { cwd: ROOT, encoding: 'utf8' });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  };

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });

    // Make require('ajv'), require('ajv/dist/2020'), and require('ajv-formats')
    // fail exactly as if the packages were never installed — the README's
    // "reduced validator, loud warning" promise, exercised for real.
    fs.writeFileSync(stubPath, [
      "'use strict';",
      "const M = require('module');",
      "const orig = M._load;",
      "M._load = function (request) {",
      "  if (/^ajv(\\/|$)|^ajv-formats(\\/|$)/.test(request)) {",
      "    const e = new Error(\"Cannot find module '\" + request + \"'\");",
      "    e.code = 'MODULE_NOT_FOUND';",
      "    throw e;",
      "  }",
      "  return orig.apply(this, arguments);",
      "};",
    ].join('\n') + '\n', 'utf8');

    const base = readContent('example-contractor');
    writeContent(CLIENT, base);

    // (a) Valid content: the degraded build SUCCEEDS (exit 0), warns loudly
    //     with the fix named, and writes real HTML.
    let r = buildNoAjv();
    if (r.status !== 0) failures.push(`no-AJV build of valid content failed (exit ${r.status}):\n${r.out}`);
    if (!/AJV not installed/.test(r.out)) failures.push(`the no-AJV build did not emit the loud warning (output starts: ${r.out.slice(0, 160)})`);
    if (!/npm install/.test(r.out)) failures.push('the warning does not tell the operator the fix (npm install)');
    const indexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexPath)) failures.push('the no-AJV build wrote no index.html');
    else if (!fs.readFileSync(indexPath, 'utf8').includes('<h1')) failures.push('the no-AJV index.html carries no rendered content');

    // Control: the same content with AJV present builds with NO warning — the
    // degraded path never fires when the real validator is available.
    const withAjv = build(CLIENT);
    if (!withAjv.ok) failures.push(`control build with AJV failed:\n${withAjv.out}`);
    else if (/AJV not installed/.test(withAjv.out)) failures.push('the AJV-present build warns as if AJV were missing');

    // (b) The reduced validator still guards. A javascript: href must be
    //     refused with a non-zero exit and NOTHING written (the scheme guard
    //     validate.js keeps a fallback copy of).
    fs.rmSync(distDir, { recursive: true, force: true });
    const badHref = JSON.parse(JSON.stringify(base));
    const heroAction = badHref.pages.find(p => p.slug === 'index')
      .blocks.find(bl => bl.type === 'hero').fields.actions[0];
    heroAction.href = 'javascript:alert(1)';
    writeContent(CLIENT, badHref);
    r = buildNoAjv();
    if (r.status === 0) failures.push('a javascript: href passed the fallback validator');
    if (fs.existsSync(path.join(distDir, 'index.html'))) failures.push('the refused javascript:-href build still wrote output');

    // (c) Structural floor: content with no pages is refused too.
    writeContent(CLIENT, { site: base.site, pages: [] });
    r = buildNoAjv();
    if (r.status === 0) failures.push('structurally-empty content (no pages) passed the fallback validator');
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — with ajv/ajv-formats unresolvable, a valid client still builds (exit 0)');
    console.log('       with a loud warning naming the fix, and the output is real HTML; the same');
    console.log('       build with AJV present emits no warning; and the reduced validator still');
    console.log('       refuses a javascript: href and structurally-empty content with nothing');
    console.log('       written — the dependency-free fallback is exercised, not just promised.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 32 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 32 — Photo-strip doorways announce where they go, on every kind of pointer ═══');
{
  const CLIENT  = '__proof-strip';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];

  // One cell of the built strip, located by the image it renders.
  const cellOf = (html, imgPath) => {
    const i = html.indexOf(imgPath);
    if (i < 0) return null;
    const open = html.lastIndexOf('<a class="photo-strip-cell', i);
    const div  = html.lastIndexOf('<div class="photo-strip-cell', i);
    const start = Math.max(open, div);
    const end = html.indexOf(start === open ? '</a>' : '</div>', i);
    return start < 0 || end < 0 ? null : html.slice(start, end);
  };

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });

    const base = readContent('example-contractor');
    const content = JSON.parse(JSON.stringify(base));
    const photos = [
      { id: 'p-plain', image: 'img/project-1.jpg' },
      { id: 'p-linked', image: 'img/project-2.jpg', link: 'gallery.html', linkLabel: 'Deck photos' },
      { id: 'p-default-label', image: 'img/project-3.jpg', link: 'gallery.html' },
    ];
    content.pages.find(p => p.slug === 'index').blocks.push({
      id: 'strip-main', type: 'photo-strip', fields: { heading: 'Recent work', photos },
    });
    writeContent(CLIENT, content);

    const r = build(CLIENT);
    if (!r.ok) failures.push(`the strip build failed:\n${r.out}`);
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

    // (a) A LINKED cell's accessible name is the cue text and nothing else:
    //     the image is decorative inside the link, the cue is exposed, and only
    //     the arrow glyph is hidden. This is the whole defect — four linked
    //     photos used to announce as four identical site names, with the one
    //     part that says where they go hidden from assistive tech.
    const linked = cellOf(html, 'img/project-2.jpg');
    if (!linked) failures.push('the linked cell did not render');
    else {
      if (!/<img [^>]*alt=""/.test(linked)) failures.push(`a linked cell's image must be decorative (alt="") so it does not compete with the cue for the link's name: ${linked.slice(0, 200)}`);
      if (/class="photo-strip-cue"[^>]*aria-hidden/.test(linked)) failures.push('the cue is still aria-hidden — the one part of the link that says where it goes is hidden from assistive tech');
      if (!linked.includes('>Deck photos<')) failures.push('the cue does not carry the linkLabel text');
      if (!/class="photo-strip-cue-arrow" aria-hidden="true"/.test(linked)) failures.push('the decorative arrow is not aria-hidden — it would trail every announcement with a stray glyph');
    }

    // The default label still applies where linkLabel is unset.
    const defaulted = cellOf(html, 'img/project-3.jpg');
    if (!defaulted || !defaulted.includes('>View gallery<')) failures.push('a linked photo with no linkLabel lost its default cue text');

    // (b) A LINK-LESS cell is untouched: site-name alt, no cue at all.
    const plain = cellOf(html, 'img/project-1.jpg');
    if (!plain) failures.push('the link-less cell did not render');
    else {
      if (!plain.includes(`alt="${base.site.name}"`)) failures.push('a link-less photo lost its site-name alt text');
      if (plain.includes('photo-strip-cue')) failures.push('a link-less photo grew a cue');
    }

    // (c) Live build stays annotation- and id-free.
    if (/data-bk-/.test(html)) failures.push('the live strip build carries data-bk-* attributes');
    for (const p of photos) {
      if (html.includes(`"${p.id}"`)) failures.push(`live HTML leaks the item id "${p.id}"`);
    }

    // (d) The stylesheet holds up its half: the cue's fade is gated on a pointer
    //     that can actually hover. A touch device never fires :hover, and the
    //     cue is the only label there is — so it must not start invisible there.
    const css = fs.readFileSync(path.join(ROOT, 'themes', 'default', 'css', 'styles.css'), 'utf8');
    const hoverBlocks = css.match(/@media \(hover: hover\) \{[\s\S]*?\n\}/g) || [];
    if (!hoverBlocks.some(b => /\.photo-strip-cue \{\s*opacity: 0;/.test(b))) {
      failures.push('the cue\'s opacity:0 is not inside @media (hover: hover) — on a touch device the label would be invisible with no way to reveal it');
    }
    if (/\.photo-strip-cue \{[^}]*opacity: 0/.test(css.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/g, ''))) {
      failures.push('the cue is hidden by default outside the hover query');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — a linked photo-strip cell takes its accessible name from the cue (the');
    console.log('       owner-editable linkLabel), with the image decorative inside the link and');
    console.log('       only the arrow hidden, so four doorways no longer announce as four');
    console.log('       identical site names; the cue is visible by default and fades only where');
    console.log('       a pointer can hover, so touch users see a label at all; and a link-less');
    console.log('       photo is untouched — site-name alt, no cue, one edit target.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 33 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 33 — A photo strip fills its row at any photo count ═══');
{
  const CLIENT  = '__proof-strip-cols';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });

    const base = readContent('example-contractor');
    const withStrip = (fieldsExtra) => {
      const c = JSON.parse(JSON.stringify(base));
      c.pages.find(p => p.slug === 'index').blocks.push({
        id: 'strip-main', type: 'photo-strip',
        fields: Object.assign({
          heading: 'Recent work',
          photos: [
            { id: 'p-one',   image: 'img/project-1.jpg' },
            { id: 'p-two',   image: 'img/project-2.jpg' },
            { id: 'p-three', image: 'img/project-3.jpg' },
          ],
        }, fieldsExtra || {}),
      });
      return c;
    };

    // (a) No `columns` → the section carries NOTHING new. The 4-wide default
    //     lives entirely in CSS, so an untouched strip is byte-identical to the
    //     pre-feature build.
    writeContent(CLIENT, withStrip());
    let r = build(CLIENT);
    if (!r.ok) failures.push(`the strip build failed:\n${r.out}`);
    let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    if (!html.includes('<section class="photo-strip">')) {
      failures.push('a strip with no `columns` emitted attributes on its section — the unset default must be pure CSS');
    }
    if (/photo-strip-grid"[^>]/.test(html)) failures.push('a strip with no `columns` emitted attributes on its grid');

    // (b) `columns` rides the SECTION, not the grid. Load-bearing: an inline
    //     declaration on the grid would outrank every media query and freeze
    //     the count at all widths, so the responsive steps could never fire.
    writeContent(CLIENT, withStrip({ columns: 3 }));
    r = build(CLIENT);
    if (!r.ok) failures.push(`the 3-column strip build failed:\n${r.out}`);
    else {
      html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
      if (!/<section class="photo-strip" data-cols="3" style="--photo-strip-cols:3">/.test(html)) {
        failures.push('columns:3 did not paint --photo-strip-cols + data-cols on the section');
      }
      if (/photo-strip-grid"[^>]*style=/.test(html)) failures.push('the column count landed on the grid as an inline style — the responsive steps can never override that');
      if (/data-bk-/.test(html)) failures.push('the live strip build carries data-bk-* attributes');
    }

    // (c) The schema bounds the count: out-of-enum and non-integer are refused
    //     with nothing written.
    for (const bad of [7, 0, '3', 3.5]) {
      fs.rmSync(distDir, { recursive: true, force: true });
      writeContent(CLIENT, withStrip({ columns: bad }));
      if (build(CLIENT).ok) failures.push(`columns:${JSON.stringify(bad)} passed validation`);
      if (fs.existsSync(path.join(distDir, 'index.html'))) failures.push(`the refused columns:${JSON.stringify(bad)} build still wrote output`);
    }

    // (d) The stylesheet holds up its half: an unset strip still resolves to the
    //     historical 4-wide grid, and the narrower steps divide the count rather
    //     than stranding the last photo in a half-empty row.
    const css = fs.readFileSync(path.join(ROOT, 'themes', 'default', 'css', 'styles.css'), 'utf8');
    if (!/\.photo-strip-grid\s*\{[^}]*repeat\(var\(--photo-strip-cols,\s*4\),\s*1fr\)/.test(css)) {
      failures.push('the stylesheet no longer resolves an unset strip to the historical 4-wide grid');
    }
    for (const rule of ['.photo-strip[data-cols="3"] .photo-strip-grid', '.photo-strip[data-cols="5"] .photo-strip-grid']) {
      if (!css.includes(rule)) failures.push(`the responsive step for ${rule} is missing — that count would strand its last photo`);
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — the column count rides the section as a token: absent, nothing is emitted');
    console.log('       and CSS still resolves the historical 4-wide grid; set, it lands on the');
    console.log('       section (never as an inline grid-template-columns, which would outrank');
    console.log('       every media query and freeze the count at all widths) and the narrower');
    console.log('       steps divide it rather than stranding the last photo; and a count outside');
    console.log('       the schema enum is refused with nothing written.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 34 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 34 — card-grid cards can point at their own page, with a name that says which ═══');
{
  const CLIENT  = '__proof-cardlink';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];

  try {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });

    const base = readContent('example-contractor');
    const grid = {
      id: 'svc-directory', type: 'card-grid',
      fields: {
        heading: 'What we do',
        cards: [
          { id: 'c-basement', title: 'Basement Development', body: 'Finished living space.', link: 'basement.html' },
          { id: 'c-hardscape', title: 'Hardscaping', body: 'Patios and walkways.', link: 'hardscaping.html', linkLabel: 'See our work' },
          { id: 'c-plain', title: 'General Repairs', body: 'Everything else.' },
        ],
      },
    };
    const withGrid = () => {
      const c = JSON.parse(JSON.stringify(base));
      c.pages.find(p => p.slug === 'index').blocks.push(JSON.parse(JSON.stringify(grid)));
      return c;
    };

    writeContent(CLIENT, withGrid());
    let r = build(CLIENT);
    if (!r.ok) failures.push(`the card-link build failed:\n${r.out}`);
    let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

    const cardOf = (title) => {
      const i = html.indexOf(`>${title}<`);
      if (i < 0) return null;
      const start = html.lastIndexOf('<div class="service-card', i);
      const end   = html.indexOf('</div>', html.indexOf('</h3>', i));
      return start < 0 ? null : html.slice(start, end);
    };

    // (a) A LINK-LESS card is byte-identical to the pre-feature markup: same
    //     opening tag, no cue, no modifier class. The link surface is additive.
    const plain = cardOf('General Repairs');
    if (!plain) failures.push('the link-less card did not render');
    else {
      if (!plain.startsWith('<div class="service-card fade-in">')) failures.push(`a link-less card's opening tag changed: ${plain.slice(0, 80)}`);
      if (plain.includes('service-card-cue')) failures.push('a link-less card grew a link cue');
    }

    // (b) A LINKED card carries exactly ONE anchor, and its accessible name is
    //     the visible cue text plus a screen-reader-only card title — so three
    //     cards do not announce as three identical "Learn more"s. The visible
    //     label is a prefix of the accessible name (WCAG 2.5.3).
    const linked = cardOf('Basement Development');
    if (!linked) failures.push('the linked card did not render');
    else {
      const anchors = linked.match(/<a\s/g) || [];
      if (anchors.length !== 1) failures.push(`a linked card should carry exactly one anchor, found ${anchors.length}`);
      if (!linked.includes('<div class="service-card service-card--link fade-in">')) failures.push('the linked card is missing its --link modifier class');
      if (!/href="basement\.html"/.test(linked)) failures.push('the card link href did not render');
      if (!linked.includes('>Learn more<')) failures.push('the default cue label did not render');
      if (!linked.includes('<span class="sr-only"> · Basement Development</span>')) {
        failures.push('the linked card has no screen-reader-only title suffix — every card would announce as a bare "Learn more"');
      }
      if (!/class="service-card-cue-arrow" aria-hidden="true"/.test(linked)) failures.push('the decorative arrow is not aria-hidden');
    }

    // Accessible names must be DISTINCT across the grid.
    const names = (html.match(/<span class="sr-only">([^<]*)<\/span>/g) || []);
    if (new Set(names).size !== names.length) failures.push('two linked cards resolved to the same accessible name');

    // linkLabel overrides the default.
    const labelled = cardOf('Hardscaping');
    if (!labelled || !labelled.includes('>See our work<')) failures.push('linkLabel did not override the default cue text');

    // (c) Live build carries no annotations and no ids.
    if (/data-bk-/.test(html)) failures.push('the live card-link build carries data-bk-* attributes');
    for (const c of grid.fields.cards) {
      if (html.includes(`"${c.id}"`)) failures.push(`live HTML leaks the item id "${c.id}"`);
    }

    // (d) The ANNOTATED build makes link and linkLabel click-to-editable, and
    //     the edit map agrees (the annotator is gated against it).
    r = build(CLIENT, ['--annotate']);
    if (!r.ok) failures.push(`the annotated card-link build failed:\n${r.out}`);
    else {
      const ann = fs.readFileSync(path.join(ROOT, 'dist', `${CLIENT}__annotated`, 'index.html'), 'utf8');
      for (const [item, field] of [['c-basement', 'link'], ['c-hardscape', 'linkLabel'], ['c-basement', 'title']]) {
        if (!ann.includes(`data-bk-item="${item}" data-bk-field="${field}"`)) {
          failures.push(`the annotated build does not mark ${item}.${field} as editable`);
        }
      }
      const desc = buildEditMap(readContent(CLIENT)).pages
        .flatMap(p => p.blocks).find(b => b.id === 'svc-directory');
      const linkFields = desc.itemSets[0].items.find(i => i.id === 'c-basement').fields;
      if (!linkFields.includes('link')) failures.push('the edit map does not report the card link as editable');
      if (desc.itemSets[0].items.find(i => i.id === 'c-plain').fields.includes('link')) {
        failures.push('the edit map offers a link on a card that has none — it would open an editor for a field the resolver refuses to create');
      }
    }
    fs.rmSync(path.join(ROOT, 'dist', `${CLIENT}__annotated`), { recursive: true, force: true });

    // (e) The owner can REPOINT an existing link through the ordinary item
    //     path, and the site rebuilds.
    const repointed = readContent(CLIENT);
    const pr = applyPatch(repointed, { action: 'set', block: 'svc-directory', item: 'c-basement', field: 'link', value: 'basements-and-more.html' });
    if (!pr.ok) failures.push(`repointing a card link was refused: ${pr.error}`);
    else {
      writeContent(CLIENT, repointed);
      if (!build(CLIENT).ok) failures.push('the site did not rebuild after a card link was repointed');
      else if (!fs.readFileSync(path.join(distDir, 'index.html'), 'utf8').includes('href="basements-and-more.html"')) {
        failures.push('the repointed card link did not reach the built page');
      }
    }

    // (f) The scheme guard holds on BOTH validators — AJV via $defs/safeHref,
    //     and the no-AJV fallback, which used to scan only keys named `href`
    //     and would have waved a javascript: card link straight through.
    const hostile = withGrid();
    hostile.pages.find(p => p.slug === 'index').blocks
      .find(b => b.id === 'svc-directory').fields.cards[0].link = 'javascript:alert(1)';
    fs.rmSync(distDir, { recursive: true, force: true });
    writeContent(CLIENT, hostile);
    if (build(CLIENT).ok) failures.push('a javascript: card link passed validation');
    if (fs.existsSync(path.join(distDir, 'index.html'))) failures.push('the refused javascript: card link still wrote output');

    const { fallbackValidate } = require('./lib/validate');
    if (typeof fallbackValidate === 'function') {
      if (fallbackValidate(hostile).ok) failures.push('the no-AJV fallback validator accepted a javascript: card link');
      if (!fallbackValidate(withGrid()).ok) failures.push('the no-AJV fallback validator rejected a legitimate card link');
    } else {
      failures.push('validate.js no longer exports fallbackValidate — the degraded path cannot be probed');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, 'dist', `${CLIENT}__annotated`), { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — a card can carry an optional link, so a services overview becomes a real');
    console.log('       directory (one card per service, pointing at that service\'s page); the');
    console.log('       link is one always-visible anchor whose accessible name is the cue text');
    console.log('       plus a screen-reader-only card title, so no two cards announce alike; a');
    console.log('       link-less card is byte-identical to before; link and linkLabel are');
    console.log('       click-to-editable and owner-repointable through the ordinary item path;');
    console.log('       and a javascript: target is refused by BOTH validators — including the');
    console.log('       no-AJV fallback, which only ever scanned keys named "href".');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 35 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 35 — Nav submenus: children reachable, the hub link kept, a flat nav unchanged ═══');
{
  const CLIENT  = '__proof-navsub';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];
  const navPartial = require('./partials/nav');
  // Anchor a rendered <a> by its exact href (hrefs here are literal page names).
  const linkRe = (href, extra = '') => new RegExp(`<a href="${href.replace(/\./g, '\\.')}"${extra}`);

  try {
    const base = readContent('example-contractor');

    // (a) A link with NO children renders byte-identically: a bare anchor, no
    //     wrapper, no caret. The submenu surface is purely additive.
    const flatSite = JSON.parse(JSON.stringify(base.site));
    const flatNav = navPartial(flatSite, 'index');
    if (/nav-item|nav-sub|nav-caret/.test(flatNav)) failures.push('a flat nav grew submenu markup');
    for (const l of flatSite.nav.links) {
      if (!flatNav.includes(`<a href="${l.href}"`)) failures.push(`the flat nav lost its "${l.label}" link`);
    }

    // (b) Children render inside one .nav-item > .nav-sub, and the PARENT STAYS
    //     A REAL LINK to its hub page — on a device with no hover that link is
    //     the only way in, so it is never traded for a pure toggle.
    const subSite = JSON.parse(JSON.stringify(base.site));
    const parentIdx = Math.max(0, subSite.nav.links.findIndex(l => /services/i.test(l.href)));
    const parent = subSite.nav.links[parentIdx];
    const parentHref = parent.href;
    parent.children = [
      { label: 'Basement Development', href: 'basement.html' },
      { label: 'Hardscaping', href: 'hardscaping.html' },
    ];
    const subNav = navPartial(subSite, 'index');
    if (!subNav.includes('<span class="nav-item">')) failures.push('a nav link with children did not render its wrapper');
    if (!subNav.includes('<span class="nav-sub">')) failures.push('the submenu panel did not render');
    if (!linkRe(parentHref, '[^>]*>[^<]*<span class="nav-caret"').test(subNav)) {
      failures.push('the parent is no longer a real link carrying its own href — the hub page would become unreachable wherever hover does not exist');
    }
    for (const c of parent.children) {
      if (!subNav.includes(`<a href="${c.href}">${c.label}</a>`)) failures.push(`the child link "${c.label}" did not render`);
    }
    if (!/<span class="nav-caret" aria-hidden="true">/.test(subNav)) failures.push('the caret is not aria-hidden — pure decoration must stay out of the link name');

    // (c) The parent reads as ACTIVE when the current page is one of its
    //     children. Exact-slug matching alone left a parent with eight children
    //     looking inactive on nearly every page of the site.
    const onChild = navPartial(subSite, 'hardscaping');
    if (!linkRe(parentHref, ' class="active"').test(onChild)) {
      failures.push('the parent does not read as active while one of its children is the current page');
    }
    if (!onChild.includes('<a href="hardscaping.html" class="active">')) failures.push('the current child is not marked active');
    if (onChild.includes('<a href="basement.html" class="active">')) failures.push('a non-current child was marked active');
    if (linkRe(parentHref, ' class="active"').test(navPartial(subSite, 'contact'))) {
      failures.push('the parent reads as active on a page that is neither it nor one of its children');
    }

    // (d) Child hrefs ride the same scheme guard as every other link, and a
    //     second level of nesting is refused — one level is the contract.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const good = JSON.parse(JSON.stringify(base));
    good.site = JSON.parse(JSON.stringify(subSite));
    writeContent(CLIENT, good);
    const r = build(CLIENT);
    if (!r.ok) failures.push(`a site with a nav submenu failed to build:\n${r.out}`);
    else {
      const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
      if (!html.includes('class="nav-sub"')) failures.push('the submenu did not reach the built page');
      if (/data-bk-/.test(html)) failures.push('the live nav-submenu build carries data-bk-* attributes');
    }

    const bad = JSON.parse(JSON.stringify(good));
    bad.site.nav.links[parentIdx].children[0].href = 'javascript:alert(1)';
    fs.rmSync(distDir, { recursive: true, force: true });
    writeContent(CLIENT, bad);
    if (build(CLIENT).ok) failures.push('a javascript: child href passed validation');
    if (fs.existsSync(path.join(distDir, 'index.html'))) failures.push('the refused javascript: child href still wrote output');

    const deep = JSON.parse(JSON.stringify(good));
    deep.site.nav.links[parentIdx].children[0].children = [{ label: 'Deeper', href: 'x.html' }];
    fs.rmSync(distDir, { recursive: true, force: true });
    writeContent(CLIENT, deep);
    if (build(CLIENT).ok) failures.push('a second level of nav nesting passed validation');

    // (e) The stylesheet holds up its half. :focus-within must be UNGATED —
    //     it is the whole reason a keyboard or screen-reader user can reach the
    //     children. :hover must be gated on a pointer that can hover, so
    //     sticky-hover on a touch screen cannot pin a menu open over the page.
    const css = fs.readFileSync(path.join(ROOT, 'themes', 'default', 'css', 'styles.css'), 'utf8');
    const HOVER_QUERY = /@media \(hover: hover\) \{[\s\S]*?\n\}/g;
    const hoverBlocks = css.match(HOVER_QUERY) || [];
    if (!hoverBlocks.some(b => /\.nav-item:hover \.nav-sub/.test(b))) {
      failures.push('the submenu hover rule is not gated on @media (hover: hover) — sticky-hover on touch could pin a menu open over the page');
    }
    if (!/\.nav-item:focus-within \.nav-sub \{ display: flex; \}/.test(css.replace(HOVER_QUERY, ''))) {
      failures.push('the :focus-within reveal is missing or gated — keyboard and screen-reader users could never reach the children');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — a nav link can carry one level of children: the parent stays a real link');
    console.log('       to its hub page (the only way in where hover does not exist), reads as');
    console.log('       active while any child is the current page, and its caret stays out of');
    console.log('       the link name; a childless link is byte-identical to before; child hrefs');
    console.log('       ride the same scheme guard and a second level is refused; and disclosure');
    console.log('       is CSS — :focus-within ungated so keyboard and AT users can open it,');
    console.log('       :hover gated so sticky-hover on touch cannot pin it open over the page.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 36 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 36 — The footer grid follows its column count; three columns stay untouched ═══');
{
  const failures = [];
  const footerPartial = require('./partials/footer');
  const bk = { f: () => '' };

  try {
    const base = readContent('example-contractor');
    const footerWith = (n) => {
      const site = JSON.parse(JSON.stringify(base.site));
      const one = site.footer.columns[0];
      site.footer.columns = Array.from({ length: n }, (_, i) => ({ ...one, heading: `Col ${i + 1}` }));
      return footerPartial(site, bk);
    };

    // (a) Three columns emit NOTHING. `footer.columns` has always been an
    //     unbounded array while the CSS was `2fr 1fr 1fr 1fr` — brand plus
    //     exactly three — so the overwhelmingly common case must stay
    //     byte-identical to the pre-feature output.
    if (!footerWith(3).includes('<div class="footer-grid">')) {
      failures.push('a three-column footer emitted a column-count style — the common case must stay byte-identical');
    }

    // (b) Any other count emits the track count the stylesheet reads, so the
    //     schema and the layout finally agree about how many columns exist.
    for (const n of [2, 4, 5]) {
      if (!footerWith(n).includes(`<div class="footer-grid" style="--footer-cols:${n}">`)) {
        failures.push(`a ${n}-column footer did not emit --footer-cols:${n}`);
      }
    }

    // Every column still renders whatever the count.
    const four = footerWith(4);
    for (let i = 1; i <= 4; i++) {
      if (!four.includes(`<h4>Col ${i}</h4>`)) failures.push(`the 4-column footer dropped column ${i}`);
    }

    // (c) The stylesheet resolves an unset footer to the historical template,
    //     and the property lands where the responsive rules can still win.
    const css = fs.readFileSync(path.join(ROOT, 'themes', 'default', 'css', 'styles.css'), 'utf8');
    if (!/\.footer-grid\s*\{[^}]*grid-template-columns:\s*2fr repeat\(var\(--footer-cols,\s*3\),\s*1fr\)/.test(css)) {
      failures.push('the stylesheet no longer resolves an unset footer to the historical 2fr 1fr 1fr 1fr');
    }
    if (!/\.footer-grid \{ grid-template-columns: 1fr 1fr; \}/.test(css)) {
      failures.push('the 900px footer step is gone — a wide column count would never narrow');
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  }

  if (failures.length === 0) {
    console.log('PASS — the footer grid is 2fr plus one track per column, with the count emitted');
    console.log('       ONLY when it is not three: an existing three-column footer is');
    console.log('       byte-identical and still resolves to the historical 2fr 1fr 1fr 1fr,');
    console.log('       while a fourth column finally gets its own track instead of wrapping');
    console.log('       into a lopsided row — and the responsive steps still override it.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 37 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 37 — The building-trade glyphs render, and the published icon list matches the set ═══');
{
  const CLIENT  = '__proof-icons';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const distDir = path.join(ROOT, 'dist', CLIENT);
  const failures = [];
  const { ICONS, getIcon } = require('./lib/icons');
  const TRADES = ['stairs', 'brick', 'roof', 'fence', 'ruler', 'hardhat', 'bolt', 'droplet'];

  try {
    // (a) Every trade glyph resolves to real SVG markup — not an empty string,
    //     which is what iconSvg() silently renders for an unknown name.
    for (const name of TRADES) {
      const svg = getIcon(name);
      if (!svg || !/^<(path|polyline|polygon|rect|circle|line)/.test(svg)) {
        failures.push(`the "${name}" icon is missing or is not SVG markup`);
      }
    }

    // (b) They reach a built page through the ordinary card `icon` field, one
    //     <svg> per card — the additions are useless if the renderer can't
    //     resolve them.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const content = readContent('example-contractor');
    content.pages.find(p => p.slug === 'index').blocks.push({
      id: 'trades-grid', type: 'card-grid',
      fields: {
        heading: 'Trades',
        cards: TRADES.map((icon, i) => ({ id: `trade-${i}`, icon, title: `Trade ${i}` })),
      },
    });
    writeContent(CLIENT, content);
    const r = build(CLIENT);
    if (!r.ok) failures.push(`the trade-icon build failed:\n${r.out}`);
    else {
      const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
      const icons = html.match(/<div class="card-icon"><svg viewBox="0 0 24 24">/g) || [];
      if (icons.length < TRADES.length) {
        failures.push(`only ${icons.length} of ${TRADES.length} trade icons rendered — an unknown name renders as nothing at all`);
      }
    }

    // (c) BLOCK_CATALOG's published list is the contract the maintenance tier
    //     reads ("may only reference a name that already exists"), so drift in
    //     EITHER direction is a defect: an icon nobody knows about, or a
    //     documented name that renders empty.
    const catalog = fs.readFileSync(path.join(ROOT, 'BLOCK_CATALOG.md'), 'utf8');
    const from    = catalog.indexOf('## Icons');
    const listed  = catalog.slice(catalog.indexOf('Current set:', from), catalog.indexOf('The maintenance tier', from));
    const documented = new Set((listed.match(/`([a-z]+)`/g) || []).map(s => s.slice(1, -1)));
    for (const name of Object.keys(ICONS)) {
      if (!documented.has(name)) failures.push(`icon "${name}" exists but is not listed in BLOCK_CATALOG.md § Icons`);
    }
    for (const name of documented) {
      if (!ICONS[name]) failures.push(`BLOCK_CATALOG.md § Icons lists "${name}", which does not exist in the set`);
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  if (failures.length === 0) {
    console.log('PASS — the eight building-trade glyphs (stairs, brick, roof, fence, ruler,');
    console.log('       hardhat, bolt, droplet) resolve to real SVG and reach a built page');
    console.log('       through the ordinary card `icon` field; and BLOCK_CATALOG\'s published');
    console.log('       list matches the set in both directions, so the contract the');
    console.log('       maintenance tier reads can never drift from what actually renders.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 38 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 38 — Form source tag: two forms, one inbox, told apart — and never owner surface ═══');
{
  const owner       = require('./lib/owner');
  const contactForm = require('./blocks/contact-form');
  const { NOOP_BLOCK } = require('./lib/annotate');
  const CLIENT  = '__proof-form-source';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const failures = [];

  try {
    // The attribution case, set up literally: TWO forms with the SAME
    // formAction (one inbox, one notification config — the whole point) that
    // differ only by their source tag. example-contractor's contact page has the
    // full form; a short one goes on the home page beside it.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const base  = readContent('example-contractor');
    const index = base.pages.find(p => p.slug === 'index');
    const cForm = base.pages.find(p => p.slug === 'contact').blocks.find(b => b.type === 'contact-form');
    if (!cForm) failures.push('test premise broken: example-contractor has no contact-form');
    cForm.fields.source = 'contact-page';
    const homeForm = JSON.parse(JSON.stringify(cForm));
    homeForm.id = 'home-lead-form';
    homeForm.fields.source = 'home-hero';
    homeForm.fields.fields = homeForm.fields.fields.slice(0, 2);
    index.blocks.push(homeForm);
    writeContent(CLIENT, base);
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Source Proof', publish: 'none' }) + '\n', 'utf8');

    // (a) Both forms build, both POST to the same endpoint, and each carries its
    //     own origin tag — the attribution a marketing company reads.
    const b1 = build(CLIENT);
    if (!b1.ok) failures.push(`the two-form build failed:\n${b1.out}`);
    else {
      const home    = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      const contact = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'contact.html'), 'utf8');
      if (!home.includes('<input type="hidden" name="source" value="home-hero">')) {
        failures.push('the home form did not render its source tag');
      }
      if (!contact.includes('<input type="hidden" name="source" value="contact-page">')) {
        failures.push('the contact form did not render its source tag');
      }
      const action = 'action="' + cForm.fields.formAction + '"';
      if (!home.includes(action) || !contact.includes(action)) {
        failures.push('the two forms no longer share one endpoint — the source tag exists to avoid splitting inboxes');
      }
    }

    // (b) Additive: a form with no source tag renders EXACTLY as before, so no
    //     existing client's form changes by a byte.
    const noSource = JSON.parse(JSON.stringify(cForm.fields));
    delete noSource.source;
    const before = contactForm(noSource, base.site, NOOP_BLOCK);
    if (before.includes('name="source"')) failures.push('a form without a source tag rendered one anyway');
    const withSource = contactForm(cForm.fields, base.site, NOOP_BLOCK);
    const inserted = '<input type="hidden" name="source" value="contact-page">\n      ';
    if (!withSource.includes(inserted)) failures.push('the source tag did not render in the expected form position');
    if (withSource.replace(inserted, '') !== before) {
      failures.push('adding a source tag changed more of the form than the one hidden input');
    }

    // (c) Rendered in netlify mode too — delivery mode and attribution are
    //     independent concerns.
    const netlify = JSON.parse(JSON.stringify(cForm.fields));
    netlify.delivery = { mode: 'netlify', formName: 'leads' };
    const netHtml = contactForm(netlify, base.site, NOOP_BLOCK);
    if (!netHtml.includes('name="source" value="contact-page"')) failures.push('netlify mode dropped the source tag');
    if (!netHtml.includes('data-netlify="true"')) failures.push('netlify mode broke while rendering the source tag');

    // (d) A hostile value renders inert, like every other content value.
    const hostile = JSON.parse(JSON.stringify(cForm.fields));
    hostile.source = '"><script>alert(1)</script>';
    const hostileHtml = contactForm(hostile, base.site, NOOP_BLOCK);
    if (hostileHtml.includes('<script>alert(1)')) failures.push('a hostile source value was not escaped');

    // (e) NOT owner surface — the edit map omits it entirely, so neither the
    //     editor nor the maintenance model is ever shown that it exists.
    const content = readContent(CLIENT);
    const map = buildEditMap(content, loadTokens(content));
    const formDesc = map.pages.find(p => p.slug === 'contact').blocks.find(b => b.id === cForm.id);
    if ((formDesc.scalars || []).some(s => s.field === 'source')) failures.push('the source tag was exposed as an editable scalar');
    if ((formDesc.creatable || []).some(c => c.field === 'source')) failures.push('the source tag was offered as a creatable field');
    if (JSON.stringify(formDesc).includes('source')) failures.push('the source tag leaked into the edit map somewhere');
    // Fields that ARE owner content on the same block are untouched by the omission.
    if (!(formDesc.scalars || []).some(s => s.field === 'heading')) failures.push('omitting the source tag also removed the form heading from the map');
    const { renderEditMap } = require('./lib/sitemap');
    if (renderEditMap(content, loadTokens(content)).includes('source')) failures.push("the model's text edit map names the source tag");

    // (f) The annotated preview stamps no annotation for it — and the map
    //     omission does not break annotation coverage in either direction
    //     (proof 1's contract, re-run on a client that has the field).
    build(CLIENT, ['--annotate']);
    const { required, allowed } = annotationSets(content, loadTokens(content));
    for (const [file, reqSet] of required) {
      const html = fs.readFileSync(path.join(ROOT, 'dist', CLIENT + '__annotated', file), 'utf8');
      const present = presentAnnotations(html);
      for (const k of reqSet) if (!present.has(k)) failures.push(`annotated ${file}: MISSING annotation ${k}`);
      for (const k of present) if (!allowed.get(file).has(k)) failures.push(`annotated ${file}: INVALID annotation ${k}`);
      if (/data-bk-field="source"/.test(html)) failures.push(`annotated ${file}: the source tag carries an annotation`);
    }

    // (g) The write path refuses it outright — at the field, and via a dotted
    //     path whose leaf is the same name, with nothing written either way.
    const orig = JSON.stringify(content);
    const rejects = [
      ['set the source tag',          { action: 'set', block: cForm.id, field: 'source', value: 'somewhere-else' }],
      ['set it to an empty value',    { action: 'set', block: cForm.id, field: 'source', value: '' }],
      ['reach it by a dotted path',   { action: 'set', block: cForm.id, field: 'delivery.source', value: 'x' }],
      ['append to it',                { action: 'append', block: cForm.id, field: 'source', value: 'x' }],
      ['delete it',                   { action: 'delete', block: cForm.id, field: 'source', match: 'contact-page' }],
    ];
    for (const [label, patch] of rejects) {
      const probe = JSON.parse(orig);
      const r = applyPatch(probe, patch);
      if (r.ok) failures.push(`a write that must be refused was accepted: ${label}`);
      if (JSON.stringify(probe) !== orig) failures.push(`a refused write (${label}) modified the content`);
    }
    // The same block's ordinary content is still writable — the refusal is
    // scoped to the one field, not to the block.
    const okProbe = JSON.parse(orig);
    if (!applyPatch(okProbe, { action: 'set', block: cForm.id, field: 'heading', value: 'Tell us more.' }).ok) {
      failures.push('the developer-only refusal spilled onto ordinary fields of the same block');
    }
    // A field of the same name on a block type that does NOT reserve it is
    // unaffected — the table is keyed by block type, not by field name globally.
    const anyItem = content.pages.flatMap(p => p.blocks).find(b => b.type === 'contact-info');
    if (anyItem) {
      const probe = JSON.parse(orig);
      const item = (probe.pages.flatMap(p => p.blocks).find(b => b.id === anyItem.id).fields.items || [])[0];
      if (item) {
        item.source = 'x';
        if (!applyPatch(probe, { action: 'set', block: anyItem.id, item: item.id, field: 'source', value: 'y' }).ok) {
          failures.push('the developer-only refusal is leaking across block types');
        }
      }
    }

    // (h) The editor cannot even open it: /api/field refuses, so the field is
    //     unreachable by read as well as by write.
    const session = owner.createSession(CLIENT);
    const d = owner.describeField(session, { block: cForm.id, field: 'source' });
    if (d.ok) failures.push('the editor described the source tag as an editable field');
    const dOk = owner.describeField(session, { block: cForm.id, field: 'heading' });
    if (!dOk.ok) failures.push(`the editor stopped describing an ordinary field on the same block: ${dOk.error}`);
    const e = owner.applyEdit(session, { action: 'set', block: cForm.id, field: 'source', value: 'nope' });
    if (e.ok) failures.push('the editor wrote the source tag');
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
    console.log('PASS — two forms sharing ONE endpoint each render their own hidden source');
    console.log('       tag, in endpoint and netlify modes alike, with a hostile value escaped');
    console.log('       and a form that omits the field byte-identical to before; and the tag is');
    console.log('       provably not owner surface — absent from the edit map and the model\'s');
    console.log('       text map, un-annotated in the annotated preview (whose coverage still');
    console.log('       holds both ways), refused by applyPatch at the field, by dotted path,');
    console.log('       and by append/delete with nothing written, and refused by the editor\'s');
    console.log('       own read path — while ordinary fields on that block, and a same-named');
    console.log('       field on another block type, keep working exactly as before.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

// ── PROOF 39 ────────────────────────────────────────────────────────────────
console.log('\n═══ PROOF 39 — reviews-link optional fields: no longer a one-way door, guarded both ways ═══');
{
  const owner = require('./lib/owner');
  const CLIENT  = '__proof-reviews-creatable';
  const liveDir = path.join(ROOT, 'clients', CLIENT);
  const candDir = path.join(ROOT, 'clients', CLIENT + '__candidate');
  const failures = [];

  try {
    // A reviews-link carrying a rating and a count (the ordinary case), plus an
    // about page-header whose subtitle will be CLEARED — the same
    // present-but-empty state, on the block type that already had creatables.
    fs.rmSync(liveDir, { recursive: true, force: true });
    fs.mkdirSync(liveDir, { recursive: true });
    const base = readContent('example-contractor');
    const index = base.pages.find(p => p.slug === 'index');
    index.blocks.push({
      id: 'home-reviews', type: 'reviews-link',
      fields: { heading: "Don't just take our word for it.", platform: 'Google',
                rating: '5.0', reviewCount: '11', url: 'https://example.com/listing' },
    });
    const header = base.pages.find(p => p.slug === 'about').blocks.find(b => b.type === 'page-header');
    writeContent(CLIENT, base);
    fs.writeFileSync(path.join(liveDir, 'owner-config.json'),
      JSON.stringify({ clientName: 'Reviews Proof', publish: 'none' }) + '\n', 'utf8');

    const content = readContent(CLIENT);
    const descOf = (c, slug, id) => buildEditMap(c, loadTokens(c))
      .pages.find(p => p.slug === slug).blocks.find(b => b.id === id);

    // (a) Present values are ordinary scalars; the absent `label` is the doorway.
    const d0 = descOf(content, 'index', 'home-reviews');
    for (const f of ['rating', 'reviewCount']) {
      if (!(d0.scalars || []).some(s => s.field === f)) failures.push(`a present ${f} is not an editable scalar`);
      if ((d0.creatable || []).some(c => c.field === f)) failures.push(`a present ${f} was also offered as creatable`);
    }
    if (!(d0.creatable || []).some(c => c.field === 'label' && c.kind === 'text')) {
      failures.push('an absent badge label is not offered as a creatable text field');
    }

    // (b) REMOVED by a developer → creatable, never a scalar (a scalar would make
    //     proof 1 demand an annotation for an element the block does not render).
    const removed = JSON.parse(JSON.stringify(content));
    const rBlock = removed.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews');
    delete rBlock.fields.rating;
    delete rBlock.fields.reviewCount;
    const d1 = descOf(removed, 'index', 'home-reviews');
    for (const f of ['rating', 'reviewCount']) {
      if (!(d1.creatable || []).some(c => c.field === f)) failures.push(`a removed ${f} is not offered back as creatable — the one-way door`);
      if ((d1.scalars || []).some(s => s.field === f)) failures.push(`a removed ${f} was left in scalars`);
    }

    // (c) CLEARED by the owner → the same doorway. Clearing is the documented way
    //     to drop an optional value, and a cleared field still exists, so without
    //     this it would sit in the map with no element to click.
    const cleared = JSON.parse(JSON.stringify(content));
    const cBlock = cleared.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews');
    cBlock.fields.rating = '';
    cBlock.fields.reviewCount = '   ';
    const d2 = descOf(cleared, 'index', 'home-reviews');
    for (const f of ['rating', 'reviewCount']) {
      if (!(d2.creatable || []).some(c => c.field === f)) failures.push(`a cleared ${f} is not offered back as creatable`);
      if ((d2.scalars || []).some(s => s.field === f)) failures.push(`a cleared ${f} was left in scalars with nothing to click`);
    }
    // The same rule reaches the block type that already had creatables.
    const clearedSub = JSON.parse(JSON.stringify(content));
    clearedSub.pages.find(p => p.slug === 'about').blocks.find(b => b.id === header.id).fields.subhead = '';
    const d3 = descOf(clearedSub, 'about', header.id);
    if (!(d3.creatable || []).some(c => c.field === 'subhead')) failures.push('a cleared page-header subtitle is not offered back as creatable');
    if ((d3.scalars || []).some(s => s.field === 'subhead')) failures.push('a cleared page-header subtitle was left in scalars');
    // A field that still RENDERS when empty stays a click-reachable scalar — a
    // page-header background falls back to the site hero, so it is not a doorway.
    const clearedBg = JSON.parse(JSON.stringify(content));
    clearedBg.pages.find(p => p.slug === 'about').blocks.find(b => b.id === header.id).fields.background = '';
    const d4 = descOf(clearedBg, 'about', header.id);
    if (!(d4.scalars || []).some(s => s.field === 'background')) failures.push('a cleared inheriting background stopped being a scalar');
    if ((d4.creatable || []).some(c => c.field === 'background')) failures.push('a cleared inheriting background became a doorway it does not need');

    // (d) CREATE path: guarded, and a refusal says what is wrong with the VALUE
    //     rather than reporting the field missing.
    const removedText = JSON.stringify(removed);
    const okCreates = [['rating', '4.9'], ['reviewCount', '1,204'], ['label', 'Rated best in town']];
    for (const [field, value] of okCreates) {
      const probe = JSON.parse(removedText);
      delete probe.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields.label;
      const r = applyPatch(probe, { action: 'set', block: 'home-reviews', field, value });
      if (!r.ok || !r.created) failures.push(`creating ${field} = "${value}" failed: ${r.error || 'no created flag'}`);
    }
    const badCreates = [
      ['rating', '4.85', /rating/i], ['rating', 'Awesome', /rating/i], ['rating', '7', /rating/i],
      ['reviewCount', '12 reviews', /review count/i], ['reviewCount', '-4', /review count/i],
      ['label', 'x'.repeat(201), /label/i], ['label', 'two\nlines', /label/i],
    ];
    for (const [field, value, expect] of badCreates) {
      const probe = JSON.parse(removedText);
      delete probe.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields.label;
      const r = applyPatch(probe, { action: 'set', block: 'home-reviews', field, value });
      if (r.ok) failures.push(`creating ${field} = ${JSON.stringify(value)} was accepted and must not be`);
      else if (!expect.test(r.error || '')) failures.push(`refusing ${field} = ${JSON.stringify(value)} did not explain the value: "${r.error}"`);
      else if (/does not exist/.test(r.error)) failures.push(`refusing ${field} blamed a missing field instead of the value`);
    }
    // Still narrow: a non-string, an item field, and an unrelated field are refused.
    for (const [label, patch] of [
      ['a non-string rating', { action: 'set', block: 'home-reviews', field: 'rating', value: 5 }],
      ['an invented field',   { action: 'set', block: 'home-reviews', field: 'stars', value: '5' }],
    ]) {
      const probe = JSON.parse(removedText);
      if (applyPatch(probe, patch).ok) failures.push(`a creation that must be refused was accepted: ${label}`);
    }
    // A rating on a block type NOT in the allowlist is still uncreatable.
    const foreign = content.pages.flatMap(p => p.blocks).find(b => b.type !== 'reviews-link' && !('rating' in (b.fields || {})));
    if (foreign) {
      const probe = JSON.parse(JSON.stringify(content));
      if (applyPatch(probe, { action: 'set', block: foreign.id, field: 'rating', value: '4.9' }).ok) {
        failures.push(`a rating was created on a ${foreign.type} block, which is not in the allowlist`);
      }
    }

    // (e) OVERWRITE path carries the SAME shape guard — the half that stops a
    //     cleared-then-refilled rating from coming back as anything at all.
    const origText = JSON.stringify(content);
    for (const [field, value, ok] of [
      ['rating', '4.9', true], ['rating', '', true], ['rating', 'Awesome', false], ['rating', '4.85', false],
      ['reviewCount', '250', true], ['reviewCount', '', true], ['reviewCount', 'many', false],
    ]) {
      const probe = JSON.parse(origText);
      const r = applyPatch(probe, { action: 'set', block: 'home-reviews', field, value });
      if (ok && !r.ok) failures.push(`overwriting ${field} with ${JSON.stringify(value)} was refused: ${r.error}`);
      if (!ok && r.ok) failures.push(`overwriting ${field} with ${JSON.stringify(value)} was accepted and must not be`);
      if (!ok && JSON.stringify(probe) !== origText) failures.push(`a refused overwrite of ${field} modified the content`);
    }
    // A numeric reviewCount stays a number through a guarded write (the schema
    // accepts either; a string where a number was would fail the build gate).
    const numProbe = JSON.parse(origText);
    numProbe.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields.reviewCount = 11;
    const numR = applyPatch(numProbe, { action: 'set', block: 'home-reviews', field: 'reviewCount', value: 250 });
    const stored = numProbe.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields.reviewCount;
    if (!numR.ok || typeof stored !== 'number') failures.push(`a numeric review count did not stay numeric: ${JSON.stringify(stored)}`);

    // (f) Through the owner editor, end to end: the doorway opens an empty text
    //     editor, the Section panel offers it, and the created value publishes.
    const noRating = JSON.parse(JSON.stringify(content));
    delete noRating.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields.rating;
    writeContent(CLIENT, noRating);
    const session = owner.createSession(CLIENT);
    const dF = owner.describeField(session, { block: 'home-reviews', field: 'rating' });
    if (!dF.ok || dF.kind !== 'text' || dF.value !== '' || !dF.creating) {
      failures.push(`the editor did not open the missing rating as an empty creating text field: ${JSON.stringify(dF)}`);
    }
    const sec = owner.describeSection(session, { block: 'home-reviews' });
    if (!sec.ok) failures.push(`describeSection on the reviews-link failed: ${sec.error}`);
    else {
      for (const f of ['rating', 'label']) {
        if (!(sec.addable || []).some(a => a.field === f)) failures.push(`the Section panel did not offer to add the ${f}`);
      }
    }
    const bad = owner.applyEdit(session, { action: 'set', block: 'home-reviews', field: 'rating', value: '4.85' });
    if (bad.ok) failures.push('the editor accepted a malformed rating');
    else if (!/rating/i.test(bad.error || '')) failures.push(`the editor's refusal did not explain the rating: "${bad.error}"`);
    const good = owner.applyEdit(session, { action: 'set', block: 'home-reviews', field: 'rating', value: '4.9' });
    if (!good.ok) failures.push(`creating the rating through the editor failed: ${good.error}`);
    else {
      const cand = JSON.parse(fs.readFileSync(path.join(candDir, 'content.json'), 'utf8'));
      const cf = cand.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields;
      if (cf.rating !== '4.9') failures.push(`the candidate rating is not as created: ${JSON.stringify(cf.rating)}`);
      const live = JSON.parse(fs.readFileSync(path.join(liveDir, 'content.json'), 'utf8'));
      if ('rating' in live.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields) {
        failures.push('LIVE content gained the rating before publish');
      }
    }
    owner.keep(session);
    const pub = owner.publish(session);
    if (!pub.ok) failures.push(`publish failed: ${pub.error}`);
    else {
      const html = fs.readFileSync(path.join(ROOT, 'dist', CLIENT, 'index.html'), 'utf8');
      if (!html.includes('4.9')) failures.push('the published rating is not in the live HTML');
      if (html.includes('data-bk-')) failures.push('live HTML carries data-bk-* after publish');
    }

    // (g) The blank-as-absent rule does not over-constrain the annotation proof:
    //     with a cleared rating, the annotated build still covers the map exactly.
    const clearedLive = readContent(CLIENT);
    clearedLive.pages.find(p => p.slug === 'index').blocks.find(b => b.id === 'home-reviews').fields.rating = '';
    writeContent(CLIENT, clearedLive);
    const bA = build(CLIENT, ['--annotate']);
    if (!bA.ok) failures.push(`the annotated build with a cleared rating failed:\n${bA.out}`);
    else {
      const { required, allowed } = annotationSets(clearedLive, loadTokens(clearedLive));
      for (const [file, reqSet] of required) {
        const html = fs.readFileSync(path.join(ROOT, 'dist', CLIENT + '__annotated', file), 'utf8');
        const present = presentAnnotations(html);
        for (const k of reqSet) if (!present.has(k)) failures.push(`annotated ${file}: MISSING annotation ${k}`);
        for (const k of present) if (!allowed.get(file).has(k)) failures.push(`annotated ${file}: INVALID annotation ${k}`);
      }
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
    console.log('PASS — a reviews-link\'s optional rating / review count / badge label are');
    console.log('       creatable through the same narrow allowlist a page-header subtitle uses,');
    console.log('       whether a developer REMOVED the field or the owner CLEARED it (both leave');
    console.log('       nothing rendered, so both surface as a doorway rather than an unclickable');
    console.log('       scalar — the page-header subtitle now behaves the same, while a background');
    console.log('       that still inherits stays a scalar); the shape guard holds on the create');
    console.log('       AND the overwrite path, so a cleared rating can only come back as a');
    console.log('       rating, a numeric count stays numeric, and every refusal names what was');
    console.log('       wrong with the value instead of blaming a missing field; and the created');
    console.log('       value rides the ordinary editor session to live HTML while the annotated');
    console.log('       build still matches the edit map exactly in both directions.');
    passed++;
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`${passed}/${TOTAL} proofs passed.`);
process.exit(passed === TOTAL ? 0 : 1);
