/* ============================================================
   engine/lib/scaffold.js — Blueprint scaffolder (v4, Task 3)

   The ONLY way structure (new pages / new blocks) is added by the
   maintenance tier. applyPatch stays value-only by design — its
   container and forbidden-key guards are never loosened; structural
   additions arrive through this separate, equally-guarded path.

   A BLUEPRINT is a developer-authored JSON file in blueprints/:

     {
       "name":    "Contact page",
       "purpose": "one-line description shown in the Add… menu",
       "kind":    "page" | "block",
       "variants": [ { "key": "with-form", "label": "…" }, … ],
       "inputs":  [ { "key", "label", "type": "text"|"textarea"|"image"|"select",
                      "required"?, "maxLength"?, "pattern"?, "hint"?,
                      "options"?: [{value,label}|string …]   (select only)
                      "variants"?: ["with-form"]  (active only for these)
                      "example"?: a value passing this input's own
                        constraints — used by the authoring validator and
                        the demo gallery to instantiate the blueprint.
                        Required in practice when "pattern" is declared
                        (no generic value can satisfy an arbitrary regex). } … ],
       "template": { "<variantKey>": <fragment>, … }
     }

   Validation is STRICT: unknown keys anywhere in a blueprint are
   rejected with named reasons. A typo like "requried" would otherwise
   silently make an input optional — in the two-ledger model a rejected
   blueprint is an acceptable UX cost; a silently weakened one is not.

   A page fragment is { navLabel, meta:{title,description}, blocks:[…] };
   a block fragment is one { id, type, fields } object. Template block
   `id`s are HINTS — final ids are generated here. Fragments may use
   ONLY existing block types (checked against the block registry).

   PLACEHOLDERS — {{inputKey}} anywhere in a template string, replaced
   with the validated input value. {{site.name}}, {{site.contact.phone}}
   and {{site.contact.email}} are builtins read from the client's own
   content, so blueprints reuse the site's single source of truth
   instead of asking the owner to retype it. {{inputKey|paragraphs}}
   (whole-string only) turns a textarea into an array of paragraphs
   (blank-line separated) for blocks like `text` whose body is a list.

   GUARANTEES (all deterministic, proved by proofs 9–10):
   - validateBlueprint: a malformed blueprint never reaches the UI —
     the registry (loadBlueprints) excludes it with named reasons.
   - validateInputs: every value checked against its declared schema
     (type, required, maxLength, pattern, select options, image-path
     shape). HARD per-type length ceilings apply even when a blueprint
     declares a larger maxLength — a community blueprint cannot smuggle
     a layout-breaking value through a generous cap. Any failure:
     nothing is written.
   - instantiate: ids are slugified hints, numeric-suffixed on
     collision, unique site-wide under repeated instantiation. Pages
     also get a nav entry. The caller instantiates into a CANDIDATE
     copy only and uses the full build as the acceptance gate.
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');
const BLOCKS = require('../blocks/_registry');

const ROOT = path.resolve(__dirname, '..', '..');
const BLUEPRINT_DIR = path.join(ROOT, 'blueprints');

const INPUT_TYPES = ['text', 'textarea', 'image', 'select'];
const KINDS = ['page', 'block'];

// Hard per-type value-length ceilings (a blueprint's maxLength may only
// tighten these, never exceed them) and the defaults when none declared.
const HARD_MAX    = { text: 200, textarea: 4000, image: 200, select: 100 };
const DEFAULT_MAX = { text: 120, textarea: 2000, image: 200, select: 100 };

const KEY_RE   = /^[a-zA-Z][a-zA-Z0-9_]*$/;       // input keys, variant keys
const HINT_RE  = /^[a-z][a-z0-9-]*$/;             // template id hints
const IMG_RE   = /^img\/[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|avif)$/i;
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*(?:\|([a-z-]+))?\s*\}\}/g;

// Builtin placeholders, read from the client's own content. All three
// paths are schema-required, so they always resolve.
const BUILTINS = {
  'site.name':          c => c.site.name,
  'site.contact.phone': c => c.site.contact.phone,
  'site.contact.email': c => c.site.contact.email,
};

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// base, base-2, base-3 … first value not in `taken`.
function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function collectBlockIds(content) {
  const ids = new Set();
  for (const page of content.pages || []) {
    for (const b of page.blocks || []) if (b && typeof b.id === 'string') ids.add(b.id);
  }
  return ids;
}

function optionValue(opt) { return typeof opt === 'string' ? opt : opt && opt.value; }

// Allowed keys per object shape — anything else is rejected by name.
const BP_KEYS       = new Set(['name', 'purpose', 'kind', 'variants', 'inputs', 'template']);
const VARIANT_KEYS  = new Set(['key', 'label']);
const INPUT_KEYS    = new Set(['key', 'label', 'type', 'required', 'maxLength', 'pattern',
                               'hint', 'options', 'variants', 'example']);
const PAGE_FRAG_KEYS = new Set(['navLabel', 'meta', 'blocks']);
const META_KEYS     = new Set(['title', 'description', 'ogImage']);
const BLOCK_KEYS    = new Set(['id', 'type', 'fields']);

function checkKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) errors.push(`${where}: unknown key "${k}"`);
  }
}

/* Check one non-empty TRIMMED value against an input's declared
   constraints (length cap incl. the hard ceiling, pattern, image-path
   shape, select options). Returns null when valid, else a plain-language
   error. Shared by validateInputs (owner values) and validateBlueprint
   (declared examples) so the two can never diverge. */
function validateValue(inp, v) {
  const cap = Math.min(inp.maxLength != null ? inp.maxLength : DEFAULT_MAX[inp.type], HARD_MAX[inp.type]);
  if (v.length > cap) return `${inp.label} is too long (${v.length} characters — the limit is ${cap})`;
  if (inp.pattern && !(new RegExp(inp.pattern)).test(v)) {
    return `${inp.label} doesn't look right${inp.hint ? ` — ${inp.hint}` : ''}`;
  }
  if (inp.type === 'image' && !IMG_RE.test(v)) {
    return `${inp.label} must be an image in the site's img folder (img/name.jpg)`;
  }
  if (inp.type === 'select' && !(inp.options || []).map(optionValue).includes(v)) {
    return `${inp.label}: "${v}" is not one of the offered choices`;
  }
  return null;
}

// Inputs active for one variant (no `variants` key = active everywhere).
function activeInputs(bp, variantKey) {
  return (bp.inputs || []).filter(i => !Array.isArray(i.variants) || i.variants.includes(variantKey));
}

// ── Blueprint schema validation ────────────────────────────────

// Walk every string in a fragment and yield [placeholderName, filter].
function collectPlaceholders(node, out) {
  if (typeof node === 'string') {
    let m;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((m = PLACEHOLDER_RE.exec(node))) out.push({ name: m[1], filter: m[2] || null, whole: m[0] === node });
  } else if (Array.isArray(node)) {
    for (const el of node) collectPlaceholders(el, out);
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) collectPlaceholders(node[k], out);
  }
  return out;
}

function validateTemplateBlock(block, where, errors) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    errors.push(`${where}: block is not an object`); return;
  }
  checkKeys(block, BLOCK_KEYS, where, errors);
  if (typeof block.id !== 'string' || !HINT_RE.test(block.id)) {
    errors.push(`${where}: block "id" must be a lowercase slug hint (got ${JSON.stringify(block.id)})`);
  }
  if (typeof block.type !== 'string' || !Object.prototype.hasOwnProperty.call(BLOCKS, block.type)) {
    errors.push(`${where}: unknown block type "${block.type}" — blueprints may only use existing block types`);
  }
  if (!block.fields || typeof block.fields !== 'object' || Array.isArray(block.fields)) {
    errors.push(`${where}: block "fields" must be an object`);
  }
}

/* Full schema check of one blueprint. Returns { ok, errors }. This is
   the gate the registry applies on load — an invalid blueprint is
   never offered for instantiation. */
function validateBlueprint(bp) {
  const errors = [];
  if (!bp || typeof bp !== 'object' || Array.isArray(bp)) {
    return { ok: false, errors: ['blueprint is not an object'] };
  }
  checkKeys(bp, BP_KEYS, 'blueprint', errors);
  if (typeof bp.name !== 'string' || !bp.name.trim()) errors.push('"name" must be a non-empty string');
  if (typeof bp.purpose !== 'string' || !bp.purpose.trim()) errors.push('"purpose" must be a non-empty string');
  if (!KINDS.includes(bp.kind)) errors.push(`"kind" must be one of ${KINDS.join('|')}`);

  // variants
  const variantKeys = new Set();
  if (!Array.isArray(bp.variants) || bp.variants.length === 0) {
    errors.push('"variants" must be a non-empty array');
  } else {
    bp.variants.forEach((v, i) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) checkKeys(v, VARIANT_KEYS, `variants[${i}]`, errors);
      if (!v || typeof v.key !== 'string' || !KEY_RE.test(v.key)) errors.push(`variants[${i}]: "key" must be an identifier`);
      else if (variantKeys.has(v.key)) errors.push(`variants[${i}]: duplicate key "${v.key}"`);
      else variantKeys.add(v.key);
      if (!v || typeof v.label !== 'string' || !v.label.trim()) errors.push(`variants[${i}]: "label" must be a non-empty string`);
    });
  }

  // inputs
  const inputKeys = new Set();
  const inputsByKey = new Map();
  if (!Array.isArray(bp.inputs)) {
    errors.push('"inputs" must be an array');
  } else {
    bp.inputs.forEach((inp, i) => {
      const where = `inputs[${i}]`;
      if (!inp || typeof inp !== 'object') { errors.push(`${where}: not an object`); return; }
      checkKeys(inp, INPUT_KEYS, where, errors);
      if (typeof inp.key !== 'string' || !KEY_RE.test(inp.key)) errors.push(`${where}: "key" must be an identifier`);
      else if (inputKeys.has(inp.key)) errors.push(`${where}: duplicate key "${inp.key}"`);
      else { inputKeys.add(inp.key); inputsByKey.set(inp.key, inp); }
      if (typeof inp.label !== 'string' || !inp.label.trim()) errors.push(`${where}: "label" must be a non-empty string`);
      if (!INPUT_TYPES.includes(inp.type)) errors.push(`${where}: "type" must be one of ${INPUT_TYPES.join('|')}`);
      if (inp.required != null && typeof inp.required !== 'boolean') {
        errors.push(`${where}: "required" must be true or false`);
      }
      if (inp.hint != null && typeof inp.hint !== 'string') errors.push(`${where}: "hint" must be a string`);
      if (inp.maxLength != null && (!Number.isInteger(inp.maxLength) || inp.maxLength < 1)) {
        errors.push(`${where}: "maxLength" must be a positive integer`);
      }
      let patternOk = true;
      if (inp.pattern != null) {
        if (typeof inp.pattern !== 'string') { patternOk = false; errors.push(`${where}: "pattern" must be a string`); }
        else { try { new RegExp(inp.pattern); } catch (e) { patternOk = false; errors.push(`${where}: "pattern" is not a valid regex`); } }
      }
      if (inp.example != null) {
        if (typeof inp.example !== 'string' || !inp.example.trim()) {
          errors.push(`${where}: "example" must be a non-empty string`);
        } else if (INPUT_TYPES.includes(inp.type) && patternOk) {
          const bad = validateValue(inp, inp.example.trim());
          if (bad) errors.push(`${where}: "example" fails the input's own constraints — ${bad}`);
        }
      }
      if (inp.type === 'select') {
        const vals = Array.isArray(inp.options) ? inp.options.map(optionValue) : null;
        if (!vals || vals.length === 0 || vals.some(v => typeof v !== 'string' || !v)) {
          errors.push(`${where}: a select input needs a non-empty "options" array`);
        }
      }
      if (inp.variants != null) {
        if (!Array.isArray(inp.variants) || inp.variants.some(v => !variantKeys.has(v))) {
          errors.push(`${where}: "variants" must list declared variant keys`);
        }
      }
    });
  }

  // template: exactly one fragment per declared variant
  if (!bp.template || typeof bp.template !== 'object' || Array.isArray(bp.template)) {
    errors.push('"template" must be an object keyed by variant');
  } else {
    for (const k of Object.keys(bp.template)) {
      if (!variantKeys.has(k)) errors.push(`template has key "${k}" which is not a declared variant`);
    }
    for (const k of variantKeys) {
      const frag = bp.template[k];
      if (frag === undefined) { errors.push(`template is missing variant "${k}"`); continue; }
      const where = `template.${k}`;
      if (bp.kind === 'page') {
        if (!frag || typeof frag !== 'object' || Array.isArray(frag)) { errors.push(`${where}: not an object`); continue; }
        checkKeys(frag, PAGE_FRAG_KEYS, where, errors);
        if (typeof frag.navLabel !== 'string' || !frag.navLabel.trim()) errors.push(`${where}: "navLabel" must be a non-empty string`);
        if (!frag.meta || typeof frag.meta.title !== 'string' || typeof frag.meta.description !== 'string') {
          errors.push(`${where}: "meta" must carry string "title" and "description"`);
        }
        if (frag.meta && typeof frag.meta === 'object' && !Array.isArray(frag.meta)) {
          checkKeys(frag.meta, META_KEYS, `${where}.meta`, errors);
        }
        if (!Array.isArray(frag.blocks) || frag.blocks.length === 0) {
          errors.push(`${where}: "blocks" must be a non-empty array`);
        } else {
          const hints = new Set();
          frag.blocks.forEach((b, i) => {
            validateTemplateBlock(b, `${where}.blocks[${i}]`, errors);
            if (b && typeof b.id === 'string') {
              if (hints.has(b.id)) errors.push(`${where}.blocks[${i}]: duplicate id hint "${b.id}"`);
              hints.add(b.id);
            }
          });
        }
      } else if (bp.kind === 'block') {
        validateTemplateBlock(frag, where, errors);
      }
      // every placeholder must be a declared input ACTIVE in this variant,
      // or a builtin; |paragraphs only as a whole-string input placeholder.
      const active = new Set(activeInputs(bp, k).map(i => i.key));
      for (const ph of collectPlaceholders(frag, [])) {
        if (ph.filter != null && ph.filter !== 'paragraphs') {
          errors.push(`${where}: unknown placeholder filter "|${ph.filter}"`);
        } else if (ph.filter === 'paragraphs' && !ph.whole) {
          errors.push(`${where}: {{${ph.name}|paragraphs}} must be the entire string value`);
        }
        if (Object.prototype.hasOwnProperty.call(BUILTINS, ph.name)) {
          if (ph.filter) errors.push(`${where}: builtin {{${ph.name}}} cannot take a filter`);
          continue;
        }
        if (!active.has(ph.name)) {
          errors.push(`${where}: placeholder {{${ph.name}}} is not a declared input for this variant`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Input value validation ─────────────────────────────────────

/* Validate owner-supplied values against the blueprint's declared input
   schema for one variant. Strict: unknown keys are rejected (untrusted
   input mindset — same posture as the patch resolver). Returns
   { ok, errors, values } where `values` holds the trimmed strings for
   every ACTIVE input (missing optional inputs become ''). */
function validateInputs(bp, variantKey, rawValues) {
  const errors = [];
  if (!(bp.variants || []).some(v => v.key === variantKey)) {
    return { ok: false, errors: [`unknown variant "${variantKey}"`] };
  }
  const raw = rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues) ? rawValues : {};
  const active = activeInputs(bp, variantKey);
  const activeKeys = new Set(active.map(i => i.key));
  for (const k of Object.keys(raw)) {
    if (!activeKeys.has(k)) errors.push(`"${k}" is not an input of this blueprint variant`);
  }

  const values = {};
  for (const inp of active) {
    let v = raw[inp.key];
    if (v === undefined || v === null) v = '';
    if (typeof v !== 'string') { errors.push(`${inp.label}: must be text`); continue; }
    v = v.trim();
    if (inp.required && v === '') { errors.push(`${inp.label} is required`); continue; }
    if (v !== '') {
      const bad = validateValue(inp, v);
      if (bad) { errors.push(bad); continue; }
    }
    values[inp.key] = v;
  }
  return { ok: errors.length === 0, errors, values };
}

// ── Instantiation ──────────────────────────────────────────────

function splitParagraphs(v) {
  return String(v).split(/\r?\n\s*\r?\n/)
    .map(p => p.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean);
}

// Substitute placeholders through a deep copy of a fragment.
function substitute(node, values, content) {
  if (typeof node === 'string') {
    // Whole-string |paragraphs placeholder expands to an array.
    PLACEHOLDER_RE.lastIndex = 0;
    const whole = PLACEHOLDER_RE.exec(node);
    if (whole && whole[0] === node && whole[2] === 'paragraphs') {
      return splitParagraphs(values[whole[1]] != null ? values[whole[1]] : '');
    }
    return node.replace(PLACEHOLDER_RE, (_, name) => {
      if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
      if (Object.prototype.hasOwnProperty.call(BUILTINS, name)) return String(BUILTINS[name](content));
      return ''; // unreachable for validated blueprints
    });
  }
  if (Array.isArray(node)) return node.map(el => substitute(el, values, content));
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = substitute(node[k], values, content);
    return out;
  }
  return node;
}

/**
 * Instantiate a blueprint into a content object (mutates it on success,
 * exactly like applyPatch; the caller passes a CANDIDATE copy and uses
 * the full build as the acceptance gate). Deterministic throughout.
 *
 * opts.targetSlug — required for kind "block": the page to append to.
 *
 * Returns { ok, created: { kind, slug?, file?, navLabel?, blockIds } }
 * or { ok:false, errors:[…] } with the content untouched.
 */
function instantiate(content, bp, variantKey, rawValues, opts) {
  const bpCheck = validateBlueprint(bp);
  if (!bpCheck.ok) return { ok: false, errors: bpCheck.errors };
  const iv = validateInputs(bp, variantKey, rawValues);
  if (!iv.ok) return { ok: false, errors: iv.errors };
  if (!content || !content.site || !Array.isArray(content.pages)) {
    return { ok: false, errors: ['content has no site/pages'] };
  }

  const fragment = substitute(bp.template[variantKey], iv.values, content);
  const blockIds = collectBlockIds(content);

  if (bp.kind === 'page') {
    const navLabel = String(fragment.navLabel).trim();
    if (!navLabel) return { ok: false, errors: ['the menu label came out empty'] };
    const slugs = new Set(content.pages.map(p => p.slug));
    const slug = uniqueName(slugify(navLabel) || 'page', slugs);

    const newIds = [];
    const blocks = fragment.blocks.map(b => {
      const id = uniqueName(`${slug}-${b.id}`, blockIds);
      blockIds.add(id);
      newIds.push(id);
      return { id, type: b.type, fields: b.fields };
    });

    const file = `${slug}.html`;
    content.pages.push({ slug, meta: { title: fragment.meta.title, description: fragment.meta.description }, blocks });
    content.site.nav.links.push({ label: navLabel, href: file });
    return { ok: true, created: { kind: 'page', slug, file, navLabel, blockIds: newIds } };
  }

  // kind === 'block'
  const targetSlug = opts && opts.targetSlug;
  const page = content.pages.find(p => p.slug === targetSlug);
  if (!page) return { ok: false, errors: [`unknown target page "${targetSlug}"`] };
  const id = uniqueName(`${targetSlug}-${fragment.id}`, blockIds);
  page.blocks.push({ id, type: fragment.type, fields: fragment.fields });
  return { ok: true, created: { kind: 'block', slug: targetSlug, file: `${targetSlug === 'index' ? 'index' : targetSlug}.html`, blockIds: [id] } };
}

// ── Registry ───────────────────────────────────────────────────

/* Scan blueprints/ and validate every file. A fourth (or fortieth)
   blueprint is added by dropping a JSON file in that directory — no
   code changes anywhere. Invalid files are excluded from `blueprints`
   and reported in `invalid` with named reasons. */
function loadBlueprints(dir) {
  const root = dir || BLUEPRINT_DIR;
  const blueprints = [];
  const invalid = [];
  if (!fs.existsSync(root)) return { blueprints, invalid };
  for (const file of fs.readdirSync(root).filter(f => f.endsWith('.json')).sort()) {
    const key = file.replace(/\.json$/, '');
    let bp;
    try {
      bp = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    } catch (e) {
      invalid.push({ key, file, errors: [`not valid JSON: ${e.message}`] });
      continue;
    }
    const check = validateBlueprint(bp);
    if (check.ok) blueprints.push({ key, file, blueprint: bp });
    else invalid.push({ key, file, errors: check.errors });
  }
  return { blueprints, invalid };
}

module.exports = {
  loadBlueprints, validateBlueprint, validateInputs, instantiate,
  activeInputs, slugify, BLUEPRINT_DIR,
};
