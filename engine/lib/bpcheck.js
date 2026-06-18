/* ============================================================
   engine/lib/bpcheck.js — Blueprint authoring-kit pipeline (v4, Task 4)

   Shared logic behind two thin CLIs (same split as owner.js/serve.js):
     engine/validate-blueprint.js  — validate one blueprint file
     engine/blueprints-check.js    — validate the whole registry and
                                     regenerate the demo gallery client

   checkBlueprint(file) runs the full acceptance pipeline a community
   blueprint must pass:
     1. parse + schema check (scaffold.validateBlueprint — strict)
     2. SAMPLE INSTANTIATION of every variant into a throwaway client.
        Sample values come from each input's declared "example", falling
        back to per-type defaults. An input with a "pattern" therefore
        needs an example — no generic value satisfies an arbitrary regex,
        and the failure names exactly that. An ITEM blueprint is
        instantiated into a sample block of its target type (taken from
        the SHOWCASE_BLOCKS corpus, which covers the whole registry).
     3. the FULL build (live + annotated) as the acceptance gate —
        builds are spawned, never require()d (build.js exits the process)
     4. invariant checks on the built HTML: live pages carry no
        data-bk-* and none of the created block/item ids; the annotated
        build stamps data-bk-block for every created block.
   Everything is deterministic; the throwaway client and its dist
   output are removed in a finally block, pass or fail.

   demoContent() builds the blueprint-gallery demo client: every
   registry blueprint × every variant instantiated with its example
   inputs into one content object. It is the visual gallery AND the
   regression corpus (clients/blueprint-gallery/, committed; proof 11
   fails if the committed file drifts from regeneration). When a
   blueprint has multiple variants, the nav label is suffixed with the
   variant key — only if the composed label still passes that input's
   own validation — so gallery pages are tellable apart.
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const scaffold = require('./scaffold');

const ROOT = path.resolve(__dirname, '..', '..');
const VALIDATE_CLIENT = '__bp-validate';
const GALLERY_CLIENT  = 'blueprint-gallery';

const SAMPLE_DEFAULTS = {
  text:     'Sample text',
  textarea: 'First sample paragraph.\n\nSecond sample paragraph.',
  image:    'img/sample.jpg',
};

function build(client, extra = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'build.js'), client, ...extra],
    { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

// ── Sample values ──────────────────────────────────────────────

/* Deterministic input values for one variant: declared "example" first,
   per-type defaults otherwise, then gated through the SAME validateInputs
   the owner UI uses. Returns { ok, values } or { ok:false, errors }. */
function sampleValues(bp, variantKey) {
  const values = {};
  for (const inp of scaffold.activeInputs(bp, variantKey)) {
    let v = typeof inp.example === 'string' ? inp.example : null;
    if (v == null) {
      if (inp.type === 'select') {
        const opt = (inp.options || [])[0];
        v = (typeof opt === 'string' ? opt : (opt && opt.value)) || '';
      } else {
        v = SAMPLE_DEFAULTS[inp.type] || 'Sample text';
        if (Number.isInteger(inp.maxLength)) v = v.slice(0, inp.maxLength);
      }
    }
    values[inp.key] = v;
  }
  const iv = scaffold.validateInputs(bp, variantKey, values);
  if (!iv.ok) {
    return {
      ok: false,
      errors: [
        `sample inputs for variant "${variantKey}" failed validation — declare an "example" on each constrained input (the validator and the demo gallery instantiate with examples):`,
        ...iv.errors,
      ],
    };
  }
  return { ok: true, values: iv.values };
}

// ── Base content ───────────────────────────────────────────────

/* Minimal, schema-valid, fully DETERMINISTIC content (no dates, no
   randomness) for a client named `name`. The index page exists so
   kind:"block" blueprints have a target. */
function baseContent(name, copy) {
  const c = copy || {};
  return {
    site: {
      name: c.siteName || 'Validation Sandbox',
      baseUrl: `https://${name}.example.com`,
      theme: 'default',
      logo: { white: 'img/logo-white.png', black: 'img/logo-black.png', favicon: 'img/favicon.png' },
      contact: { phone: '000-000-0000', email: `hello@${name}.example.com` },
      nav: { links: [{ label: 'Home', href: 'index.html' }] },
      footer: {
        blurb: c.footerBlurb || 'Throwaway client used to validate a blueprint.',
        columns: [{ heading: 'About', items: [{ label: c.footerNote || 'Generated — never deployed.' }] }],
      },
      copyright: c.copyright || '© Blockson contributors.',
    },
    pages: [{
      slug: 'index',
      meta: {
        title: c.indexTitle || 'Validation sandbox',
        description: c.indexDescription || 'Throwaway client used to validate a blueprint.',
      },
      blocks: [
        { id: 'index-header', type: 'page-header', fields: {
          tag: 'Home', heading: c.indexHeading || 'Validation sandbox',
          subhead: c.indexSubhead || 'Instantiated blueprint pages are linked from the menu.',
          hidden: false,
        } },
        ...(c.indexBody ? [{ id: 'index-intro', type: 'text', fields: { body: c.indexBody, hidden: false } }] : []),
      ],
    }],
  };
}

// Every string id carried by repeating items inside a block's fields.
function collectItemIds(node, out) {
  if (Array.isArray(node)) for (const el of node) collectItemIds(el, out);
  else if (node && typeof node === 'object') {
    if (typeof node.id === 'string') out.push(node.id);
    for (const k of Object.keys(node)) if (k !== 'id') collectItemIds(node[k], out);
  }
  return out;
}

// ── The acceptance pipeline for one blueprint file ─────────────

/* Returns { ok, name, checks: [passed-check descriptions], errors }.
   Never throws on bad input; never leaves the throwaway client behind. */
function checkBlueprint(filePath) {
  const checks = [];
  const errors = [];
  const file = path.resolve(ROOT, filePath);

  let bp;
  try {
    bp = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, name: path.basename(filePath), checks, errors: [`not readable as JSON: ${e.message}`] };
  }
  const name = (bp && typeof bp.name === 'string') ? bp.name : path.basename(filePath);

  const schema = scaffold.validateBlueprint(bp);
  if (!schema.ok) return { ok: false, name, checks, errors: schema.errors };
  checks.push(`schema valid — ${bp.kind}, ${bp.variants.length} variant(s), ${bp.inputs.length} input(s)`);

  // Instantiate EVERY variant into one content object (also exercises
  // id uniqueness across variants of the same blueprint). Item
  // blueprints need an existing block of their target type — a deep
  // copy of that type's SHOWCASE_BLOCKS sample is appended to the
  // throwaway index page as the target.
  const content = baseContent(VALIDATE_CLIENT);
  let targetBlock = null;
  if (bp.kind === 'item') {
    const sample = SHOWCASE_BLOCKS.find(b => b.type === bp.target.blockType);
    if (!sample) {
      return { ok: false, name, checks, errors: [`no sample block of type "${bp.target.blockType}" in the showcase corpus`] };
    }
    const copy = JSON.parse(JSON.stringify(sample));
    copy.id = 'index-target';
    content.pages[0].blocks.push(copy);
    targetBlock = copy.id;
  }
  const created = [];
  for (const variant of bp.variants) {
    const sv = sampleValues(bp, variant.key);
    if (!sv.ok) { errors.push(...sv.errors); continue; }
    const r = scaffold.instantiate(content, bp, variant.key, sv.values, { targetSlug: 'index', targetBlock });
    if (!r.ok) errors.push(...r.errors.map(e => `variant "${variant.key}": ${e}`));
    else created.push({ variant: variant.key, ...r.created });
  }
  if (errors.length) return { ok: false, name, checks, errors };
  checks.push(`every variant instantiated with its example/sample inputs`);

  const liveDir = path.join(ROOT, 'clients', VALIDATE_CLIENT);
  try {
    rmrf(liveDir);
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');

    const live = build(VALIDATE_CLIENT);
    if (!live.ok) { errors.push(`the full build rejected the instantiated content:\n${live.out}`); return { ok: false, name, checks, errors }; }
    const ann = build(VALIDATE_CLIENT, ['--annotate']);
    if (!ann.ok) { errors.push(`the annotated build failed:\n${ann.out}`); return { ok: false, name, checks, errors }; }
    checks.push('full build accepted the result (live + annotated)');

    const blocksById = new Map();
    for (const p of content.pages) for (const b of p.blocks) blocksById.set(b.id, b);

    for (const c of created) {
      const liveHtml = fs.readFileSync(path.join(ROOT, 'dist', VALIDATE_CLIENT, c.file), 'utf8');
      const annHtml  = fs.readFileSync(path.join(ROOT, 'dist', VALIDATE_CLIENT + '__annotated', c.file), 'utf8');
      if (liveHtml.includes('data-bk-')) errors.push(`${c.variant}: live ${c.file} contains data-bk-* annotations`);
      if (c.kind === 'item') {
        if (liveHtml.includes(`id="${c.itemId}"`) || liveHtml.includes(`-item="${c.itemId}"`)) {
          errors.push(`${c.variant}: live ${c.file} leaks item id "${c.itemId}"`);
        }
        if (!annHtml.includes(`data-bk-item="${c.itemId}"`)) {
          errors.push(`${c.variant}: annotated ${c.file} does not stamp item "${c.itemId}" for click-to-edit`);
        }
      }
      for (const id of c.blockIds) {
        // Ids leak as ATTRIBUTE values (id="…", data-bk-*="…"), never as
        // plain text — a substring check would false-positive on CSS class
        // names that resemble generated ids (e.g. block "contact-form" vs
        // class "contact-form").
        if (liveHtml.includes(`id="${id}"`)) errors.push(`${c.variant}: live ${c.file} leaks block id "${id}"`);
        if (!annHtml.includes(`data-bk-block="${id}"`)) {
          errors.push(`${c.variant}: annotated ${c.file} does not stamp block "${id}" for click-to-edit`);
        }
        const itemIds = collectItemIds((blocksById.get(id) || {}).fields, []);
        for (const iid of itemIds) {
          if (liveHtml.includes(`id="${iid}"`) || liveHtml.includes(`-item="${iid}"`)) {
            errors.push(`${c.variant}: live ${c.file} leaks item id "${iid}"`);
          }
        }
      }
    }
    if (!errors.length) {
      checks.push('live HTML carries no ids and no annotations; annotated HTML stamps every created block');
    }
  } catch (e) {
    errors.push(`exception during build checks: ${e.message}`);
  } finally {
    rmrf(liveDir);
    rmrf(path.join(ROOT, 'dist', VALIDATE_CLIENT));
    rmrf(path.join(ROOT, 'dist', VALIDATE_CLIENT + '__annotated'));
  }

  return { ok: errors.length === 0, name, checks, errors };
}

// ── Block showcase ─────────────────────────────────────────────

/* One schema-valid sample instance of EVERY block type, in registry
   order. Rendered as the demo gallery's "All blocks" page, this is what
   makes the gallery a real theme-coverage corpus: validate-theme builds
   it under a candidate theme and (for themes shipping their own CSS)
   checks each block's root classes against the stylesheet. Adding a
   Tier B block type without extending this list fails the theme
   validator — a deliberate ratchet. All asset paths are placeholders;
   nothing here references an external resource. */
const SHOWCASE_BLOCKS = [
  { id: 'show-hero', type: 'hero', fields: {
    tag: 'Block showcase', headline: 'Every block type, one page',
    subhead: 'Theme coverage is checked against this page — every renderer, styled by your tokens.',
    background: 'img/sample-banner.jpg',
    actions: [
      { label: 'Primary action', href: 'index.html', style: 'primary' },
      { label: 'Secondary action', href: 'index.html', style: 'secondary' },
    ] } },
  { id: 'show-page-header', type: 'page-header', fields: {
    tag: 'Showcase', heading: 'A page header band', subhead: 'The interior-page opener.', variant: 'default' } },
  { id: 'show-text', type: 'text', fields: {
    tag: 'Prose', heading: 'A text block',
    body: ['First paragraph of sample prose.', 'Second paragraph, to show paragraph spacing.'] } },
  { id: 'show-card-grid', type: 'card-grid', fields: {
    tag: 'Services', heading: 'A card grid', columns: 3,
    cards: [
      { id: 'card-one', icon: 'hammer', title: 'First card', body: 'One sentence of card body.', items: ['A sub-list line', 'Another line'] },
      { id: 'card-two', icon: 'wrench', title: 'Second card', body: 'One sentence of card body.' },
      { id: 'card-three', icon: 'home', title: 'Third card', body: 'One sentence of card body.' },
    ] } },
  { id: 'show-gallery', type: 'gallery', fields: {
    tag: 'Work', heading: 'A gallery',
    filters: [{ label: 'All', value: 'all' }],
    albums: [
      { id: 'album-1', category: 'photos', title: 'Sample album', meta: '3 photos',
        images: ['img/sample-1.jpg', 'img/sample-2.jpg', 'img/sample-3.jpg'] },
    ] } },
  { id: 'show-testimonials', type: 'testimonials', fields: {
    tag: 'Reviews', heading: 'Testimonials',
    quotes: [
      { id: 'quote-one', stars: 5, quote: 'A sample five-star quote.', attribution: 'A. Customer' },
      { id: 'quote-two', stars: 4, quote: 'A second quote, four stars.', attribution: 'B. Customer' },
    ] } },
  { id: 'show-list-panel', type: 'list-panel', fields: {
    tag: 'Details', heading: 'A list panel',
    items: ['First line', 'Second line', 'Third line', 'Fourth line'] } },
  { id: 'show-service-area', type: 'service-area', fields: {
    heading: 'A service area', body: 'One sentence about coverage.',
    areas: ['Northside', 'Southside', 'Downtown'] } },
  { id: 'show-contact-cards', type: 'contact-cards', fields: {
    cards: [
      { id: 'path-one', icon: 'mail', title: 'First path', body: 'One sentence.', items: ['Point one', 'Point two'],
        note: 'A small note.', cta: { label: 'Go', href: 'index.html', style: 'primary' } },
      { id: 'path-two', icon: 'people', title: 'Second path', body: 'One sentence.',
        cta: { label: 'Go', href: 'index.html', style: 'secondary' } },
    ] } },
  { id: 'show-contact-info', type: 'contact-info', fields: {
    items: [
      { id: 'info-phone', icon: 'phone', label: 'Call', value: '000-000-0000', href: 'tel:0000000000' },
      { id: 'info-email', icon: 'mail', label: 'Email', value: 'hello@example.com', href: 'mailto:hello@example.com' },
      { id: 'info-visit', icon: 'pin', label: 'Visit', value: '12 Main Street' },
    ] } },
  { id: 'show-contact-form', type: 'contact-form', fields: {
    tag: 'Message', heading: 'A contact form', formAction: 'https://formspree.io/f/sample',
    subjectLine: 'Showcase enquiry', submitLabel: 'Send',
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true, half: true },
      { name: 'email', label: 'Email', type: 'email', required: true, half: true },
      { name: 'message', label: 'Your message', type: 'textarea', required: true },
    ] } },
  { id: 'show-cta', type: 'cta', fields: {
    tag: 'Closing', statement: 'A closing call to action.', subtext: 'With a supporting line.',
    button: { label: 'Do the thing', href: 'index.html', style: 'primary' } } },
  { id: 'show-pricing-table', type: 'pricing-table', fields: {
    tag: 'Pricing', heading: 'A pricing table', note: 'Fine print under the grid.',
    plans: [
      { id: 'plan-basic', name: 'Basic', price: '$19', period: '/month', description: 'One line.',
        features: ['Feature one', 'Feature two'] },
      { id: 'plan-pro', name: 'Pro', price: '$49', period: '/month', description: 'One line.', featured: true,
        features: ['Everything in Basic', 'Feature three'],
        cta: { label: 'Choose Pro', href: 'index.html', style: 'primary' } },
    ] } },
  { id: 'show-team-grid', type: 'team-grid', fields: {
    tag: 'Team', heading: 'A team grid',
    members: [
      { id: 'member-one', photo: 'img/sample-1.jpg', name: 'Sam Person', role: 'Founder', bio: 'One-line bio.' },
      { id: 'member-two', name: 'Alex Person', role: 'Manager' },
    ] } },
  { id: 'show-faq', type: 'faq', fields: {
    tag: 'FAQ', heading: 'Questions',
    items: [
      { id: 'faq-one', question: 'A first question?', answer: 'Its answer.' },
      { id: 'faq-two', question: 'A second question?', answer: 'Its answer.' },
    ] } },
  { id: 'show-hours-table', type: 'hours-table', fields: {
    tag: 'Hours', heading: 'An hours table', note: 'Holiday hours may differ.',
    rows: [
      { id: 'row-weekdays', day: 'Monday – Friday', hours: '9am – 5pm' },
      { id: 'row-saturday', day: 'Saturday', hours: '10am – 2pm' },
      { id: 'row-sunday', day: 'Sunday', hours: 'Closed' },
    ] } },
  { id: 'show-before-after', type: 'before-after', fields: {
    tag: 'Results', heading: 'Before and after',
    pairs: [
      { id: 'pair-one', title: 'A sample pair', before: 'img/sample-1.jpg', after: 'img/sample-2.jpg', caption: 'One-line caption.' },
    ] } },
  { id: 'show-stats-bar', type: 'stats-bar', fields: {
    stats: [
      { id: 'stat-years', value: '14', label: 'Years in business' },
      { id: 'stat-jobs', value: '2,400', label: 'Jobs completed' },
      { id: 'stat-rating', value: '4.9', label: 'Average rating' },
    ] } },
  { id: 'show-process-steps', type: 'process-steps', fields: {
    tag: 'Process', heading: 'Process steps',
    steps: [
      { id: 'step-one', icon: 'phone', title: 'First step', body: 'One sentence.' },
      { id: 'step-two', icon: 'calendar', title: 'Second step', body: 'One sentence.' },
      { id: 'step-three', icon: 'check', title: 'Third step', body: 'One sentence.' },
    ] } },
  { id: 'show-video-embed', type: 'video-embed', fields: {
    tag: 'Video', heading: 'A video embed',
    videoUrl: 'https://www.youtube.com/embed/sample123', caption: 'One-line caption.' } },
  { id: 'show-booking-cta', type: 'booking-cta', fields: {
    tag: 'Book', statement: 'Book a time online.', subtext: 'Takes about a minute.',
    provider: 'Calendly', note: 'Opens in a new tab.',
    button: { label: 'Book now', href: 'https://calendly.com/sample' } } },
  { id: 'show-photo-strip', type: 'photo-strip', fields: {
    tag: 'Recent work', heading: 'A photo strip',
    photos: [
      { id: 'photo-one', image: 'img/sample-1.jpg' },
      { id: 'photo-two', image: 'img/sample-2.jpg' },
      { id: 'photo-three', image: 'img/sample-3.jpg' },
      { id: 'photo-four', image: 'img/sample-4.jpg' },
    ] } },
];

// Like every shipped client and blueprint (v4.2 Task 1), the showcase blocks
// carry the owner-togglable visibility flag explicitly — applied here so a
// newly added showcase block can never ship without it.
for (const b of SHOWCASE_BLOCKS) b.fields.hidden = false;

// ── Demo gallery content ───────────────────────────────────────

/* Every registry blueprint × every variant in one deterministic content
   object. Returns { ok, content, created } or { ok:false, errors }. */
function demoContent() {
  const reg = scaffold.loadBlueprints();
  const errors = [];
  for (const inv of reg.invalid) {
    errors.push(`blueprints/${inv.file} is invalid: ${inv.errors.join('; ')}`);
  }
  if (errors.length) return { ok: false, errors };

  const content = baseContent(GALLERY_CLIENT, {
    siteName: 'Blueprint Gallery',
    footerBlurb: 'Every shipped blueprint, instantiated from its example inputs — one page per variant.',
    footerNote: 'Regenerated by npm run blueprints:check',
    copyright: '© Blockson contributors — generated demo client.',
    indexTitle: 'Blueprint gallery',
    indexDescription: 'Every shipped blueprint instantiated once per variant — the visual gallery and regression corpus for the blueprint library.',
    indexHeading: 'Blueprint gallery',
    indexSubhead: 'One page per blueprint × variant, instantiated from each input’s example values.',
    indexBody: [
      'This client is GENERATED. Do not edit it by hand — run "npm run blueprints:check" to validate every blueprint and regenerate this gallery, and commit the result.',
      'Each menu entry is one blueprint variant, instantiated through engine/lib/scaffold.js exactly as the owner editor would. The pages double as the visual gallery for theme work and as the regression corpus the proof suite builds on every run.',
    ],
  });

  const created = [];
  for (const { key, blueprint: bp } of reg.blueprints) {
    if (bp.kind === 'item') continue; // items target the showcase page, built below
    for (const variant of bp.variants) {
      const sv = sampleValues(bp, variant.key);
      if (!sv.ok) return { ok: false, errors: sv.errors.map(e => `${key}: ${e}`) };
      let values = sv.values;

      // Disambiguate gallery nav labels between variants — but only when
      // the composed label still passes the input's own validation.
      const frag = bp.template[variant.key];
      if (bp.kind === 'page' && bp.variants.length > 1 && frag && typeof frag.navLabel === 'string') {
        const m = frag.navLabel.match(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)/);
        if (m && typeof values[m[1]] === 'string') {
          const trial = { ...values, [m[1]]: `${values[m[1]]}: ${variant.key}` };
          const tv = scaffold.validateInputs(bp, variant.key, trial);
          if (tv.ok) values = tv.values;
        }
      }

      const r = scaffold.instantiate(content, bp, variant.key, values, { targetSlug: 'index' });
      if (!r.ok) return { ok: false, errors: r.errors.map(e => `${key}/${variant.key}: ${e}`) };
      created.push({ blueprint: key, variant: variant.key, ...r.created });
    }
  }

  // The "All blocks" showcase page — every block type once (see
  // SHOWCASE_BLOCKS, deep-copied: item blueprints instantiate into these
  // blocks, and the module constant must never be mutated). Last in the
  // nav, after the blueprint pages.
  content.pages.push({
    slug: 'all-blocks',
    meta: {
      title: 'All blocks | Blueprint Gallery',
      description: 'One sample instance of every block type the engine renders — the theme-coverage corpus.',
    },
    blocks: JSON.parse(JSON.stringify(SHOWCASE_BLOCKS)),
  });
  content.site.nav.links.push({ label: 'All blocks', href: 'all-blocks.html' });

  // Item blueprints × variants, instantiated into the showcase block of
  // their target type — so the gallery corpus regression-covers them too.
  const showcasePage = content.pages[content.pages.length - 1];
  for (const { key, blueprint: bp } of reg.blueprints) {
    if (bp.kind !== 'item') continue;
    const host = showcasePage.blocks.find(b => b.type === bp.target.blockType);
    if (!host) return { ok: false, errors: [`${key}: no showcase block of type "${bp.target.blockType}" to instantiate into`] };
    for (const variant of bp.variants) {
      const sv = sampleValues(bp, variant.key);
      if (!sv.ok) return { ok: false, errors: sv.errors.map(e => `${key}: ${e}`) };
      const r = scaffold.instantiate(content, bp, variant.key, sv.values, { targetBlock: host.id });
      if (!r.ok) return { ok: false, errors: r.errors.map(e => `${key}/${variant.key}: ${e}`) };
      created.push({ blueprint: key, variant: variant.key, ...r.created });
    }
  }

  return { ok: true, content, created };
}

module.exports = {
  checkBlueprint, sampleValues, baseContent, demoContent, build,
  SHOWCASE_BLOCKS, VALIDATE_CLIENT, GALLERY_CLIENT,
};
