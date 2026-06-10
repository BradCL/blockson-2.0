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
        and the failure names exactly that.
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
        } },
        ...(c.indexBody ? [{ id: 'index-intro', type: 'text', fields: { body: c.indexBody } }] : []),
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
  // id uniqueness across variants of the same blueprint).
  const content = baseContent(VALIDATE_CLIENT);
  const created = [];
  for (const variant of bp.variants) {
    const sv = sampleValues(bp, variant.key);
    if (!sv.ok) { errors.push(...sv.errors); continue; }
    const r = scaffold.instantiate(content, bp, variant.key, sv.values, { targetSlug: 'index' });
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
  return { ok: true, content, created };
}

module.exports = {
  checkBlueprint, sampleValues, baseContent, demoContent, build,
  VALIDATE_CLIENT, GALLERY_CLIENT,
};
