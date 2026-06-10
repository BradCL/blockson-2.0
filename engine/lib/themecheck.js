/* ============================================================
   engine/lib/themecheck.js — Theme acceptance pipeline (v4, Task 5)

   Logic behind engine/validate-theme.js (thin CLI), mirroring the
   bpcheck.js split. checkTheme(dir) runs every check a community theme
   must pass, with named reasons:

   1. tokens.json parses; TOKEN COMPLETENESS — the required key set is
      derived from themes/default/tokens.json (the worked example IS the
      contract; no hand-maintained duplicate list), minus the `cssBase`
      meta key, which is required only when the theme ships no CSS.
   2. VALUE SAFETY — every token value passes the SAME injection
      blacklist (patch.js DANGEROUS_VALUE) that guards owner set-token
      writes: preset values land in the injected :root block exactly
      like overrides do, so they get the same gate. The six SAFE_TOKENS
      additionally pass their per-type format guards — owners edit on
      top of these values and the guards must hold from the start.
   3. HARD RULES — themes are CSS + tokens only: no .js files anywhere;
      no external network resources in any CSS file (no http(s) or
      protocol-relative URLs, no @import) — local-first means a theme
      that wants a specific font ships it and @font-faces it.
   4. CONTRAST PAIRS — declared pairs at tiered thresholds (measured so
      every shipped preset passes with headroom):
        color-text  on color-bg & color-surface . 4.5  (WCAG AA body)
        nav-text    on nav-bg ................... 4.5
        footer-text on footer-bg ................ 4.5
        btn-primary-text on btn-primary-bg ...... 3.0  (large text)
        color-muted on color-bg ................. 3.0
        color-primary / color-accent on color-bg  1.5  (MIN_CONTRAST,
          the same brand floor the owner-edit guard enforces — a preset
          must not ship a value the engine would refuse an owner)
   5. BLOCK-TYPE COVERAGE — the demo gallery client (every blueprint ×
      variant + the all-blocks showcase page) is built under the
      candidate theme; the build is the gate. The corpus must cover the
      whole block registry (a Tier B block added without extending the
      showcase fails here — deliberate ratchet). Themes shipping their
      own css/styles.css are additionally checked class-by-class: each
      block's root classes (taken from the real renderer output, not a
      hand list) must appear in the stylesheet.

   A theme directory outside themes/ is copied to themes/__theme-validate
   for the build and removed afterwards; throwaway clients and dist
   output are always cleaned up, pass or fail.
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');
const bpcheck = require('./bpcheck');
const BLOCKS  = require('../blocks/_registry');
const { NOOP_BLOCK } = require('./annotate');
const {
  SAFE_TOKENS, validateTokenValue, TOKEN_PAIRS, MIN_CONTRAST,
  parseCssColor, contrastRatio, DANGEROUS_VALUE,
} = require('./patch');

const ROOT = path.resolve(__dirname, '..', '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const TEMP_THEME  = '__theme-validate';
const TEMP_CLIENT = '__theme-validate';

/* Contrast requirements: [foreground/brand token, background token, minimum].
   TOKEN_PAIRS (patch.js) supplies the owner-editable pairs at the engine's
   own floor; the text-legibility pairs are theme-design obligations the
   owner guard never sees (text sides are not owner-editable). */
function contrastRequirements() {
  const reqs = [
    ['color-text',  'color-bg',      4.5],
    ['color-text',  'color-surface', 4.5],
    ['nav-text',    'nav-bg',        4.5],
    ['footer-text', 'footer-bg',     4.5],
    ['btn-primary-text', 'btn-primary-bg', 3.0],
    ['color-muted', 'color-bg',      3.0],
  ];
  for (const [token, partners] of Object.entries(TOKEN_PAIRS)) {
    for (const partner of partners) {
      // Skip pairs the text requirements already cover at a higher bar.
      if (!reqs.some(([a, b]) => (a === token && b === partner) || (a === partner && b === token))) {
        reqs.push([token, partner, MIN_CONTRAST]);
      }
    }
  }
  return reqs;
}

// Required token keys = the default theme's keys (the worked example is
// the contract) minus the cssBase meta key (conditionally required).
function requiredTokens() {
  const def = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, 'default', 'tokens.json'), 'utf8'));
  return Object.keys(def).filter(k => k !== 'cssBase');
}

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Utility classes shared across many blocks — styling only these says
// nothing about covering a specific block type.
const GENERIC_CLASSES = new Set([
  'container', 'fade-in', 'btn', 'btn-primary', 'btn-secondary',
  'section-tag', 'section-header',
]);

// Every block-specific class one rendered block emits (real renderer
// output, not a hand-kept list).
function blockClasses(type, fields, site) {
  const html = BLOCKS[type](fields, site, NOOP_BLOCK);
  const out = new Set();
  for (const m of String(html).matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1].trim().split(/\s+/)) {
      if (!GENERIC_CLASSES.has(cls)) out.add(cls);
    }
  }
  return [...out];
}

/* Run every check on one theme directory.
   Returns { ok, name, checks, errors, warnings }. */
function checkTheme(dirPath) {
  const checks = [];
  const errors = [];
  const warnings = [];
  const dir = path.resolve(ROOT, dirPath);
  const name = path.basename(dir);

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, name, checks, errors: [`"${dirPath}" is not a directory`], warnings };
  }
  let tokens;
  try {
    tokens = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'));
  } catch (e) {
    return { ok: false, name, checks, errors: [`tokens.json missing or not valid JSON: ${e.message}`], warnings };
  }

  // 1. Token completeness
  const required = requiredTokens();
  const missing = required.filter(k => typeof tokens[k] !== 'string' || !tokens[k].trim());
  for (const k of missing) errors.push(`missing required token "${k}" (the required set is the default theme's keys)`);
  if (!missing.length) checks.push(`token set complete (${required.length} required keys)`);

  // 2. Value safety — same gates the owner-edit path runs
  for (const [k, v] of Object.entries(tokens)) {
    if (typeof v !== 'string') { errors.push(`token "${k}" must be a string value`); continue; }
    if (DANGEROUS_VALUE.test(v)) {
      errors.push(`token "${k}" fails the injection guard (no ; { } < > url( comments or escapes): ${JSON.stringify(v)}`);
    }
  }
  let safeOk = true;
  for (const [k, type] of Object.entries(SAFE_TOKENS)) {
    if (typeof tokens[k] !== 'string') continue;
    const g = validateTokenValue(type, tokens[k]);
    if (!g.ok) { safeOk = false; errors.push(`safe token "${k}" must satisfy its ${type} format guard — ${g.error}`); }
  }
  if (safeOk) checks.push('every token value passes the injection guard; safe tokens pass their format guards');

  // 3. Hard rules: CSS + tokens only, self-contained.
  // Exemption: themes/default/js/ in THIS repo is the engine's shared JS
  // base — build.js copies it into every theme's output, so it is engine
  // code (Tier B surface), not theme surface. A contributed theme (any
  // other directory, including one copied in for validation) ships no JS.
  const isEngineBase = dir === path.join(THEMES_DIR, 'default');
  const files = listFiles(dir);
  for (const f of files) {
    const rel = path.relative(dir, f);
    if (f.endsWith('.js') && !(isEngineBase && rel.split(path.sep)[0] === 'js')) {
      errors.push(`themes are CSS + tokens only — no JavaScript (found ${rel})`);
    }
    if (f.endsWith('.css')) {
      const css = fs.readFileSync(f, 'utf8');
      if (/https?:\/\/|url\(\s*['"]?\/\//i.test(css)) {
        errors.push(`${rel} references an external resource — themes must be self-contained (self-host fonts with @font-face)`);
      }
      if (/@import/i.test(css)) {
        errors.push(`${rel} uses @import — ship one self-contained stylesheet instead`);
      }
    }
  }
  if (!errors.some(e => e.includes('CSS + tokens only') || e.includes('external resource') || e.includes('@import'))) {
    checks.push('no JavaScript, no external resources, no @import');
  }

  // 4. CSS resolution: own stylesheet or a resolvable cssBase
  const ownCss = fs.existsSync(path.join(dir, 'css', 'styles.css'));
  if (!ownCss) {
    const base = tokens.cssBase;
    if (typeof base !== 'string' || !base.trim()) {
      errors.push('declare "cssBase" naming the theme whose CSS this preset rides on, or ship css/styles.css');
    } else if (!fs.existsSync(path.join(THEMES_DIR, base, 'css', 'styles.css'))) {
      errors.push(`cssBase "${base}" does not resolve to themes/${base}/css/styles.css`);
    } else {
      checks.push(`token preset riding the shared "${base}" stylesheet`);
    }
  } else {
    checks.push('ships its own css/styles.css');
  }

  // 5. Contrast pairs
  let contrastOk = true;
  for (const [fg, bg, min] of contrastRequirements()) {
    const a = tokens[fg], b = tokens[bg];
    if (typeof a !== 'string' || typeof b !== 'string') continue; // missing keys already reported
    const ra = parseCssColor(a), rb = parseCssColor(b);
    if (!ra || !rb) {
      warnings.push(`could not parse "${fg}" (${a}) vs "${bg}" (${b}) as colors — contrast not checked`);
      continue;
    }
    const ratio = contrastRatio(ra, rb);
    if (ratio < min) {
      contrastOk = false;
      errors.push(`contrast: "${fg}" (${a}) on "${bg}" (${b}) is ${ratio.toFixed(2)} — the minimum for this pair is ${min}`);
    }
  }
  if (contrastOk) checks.push('all declared contrast pairs clear their thresholds');

  if (errors.length) return { ok: false, name, checks, errors, warnings };

  // 6. Block-type coverage: build the demo gallery client under this theme
  const demo = bpcheck.demoContent();
  if (!demo.ok) return { ok: false, name, checks, errors: demo.errors, warnings };

  const corpusTypes = new Set();
  for (const p of demo.content.pages) for (const b of p.blocks) corpusTypes.add(b.type);
  const uncovered = Object.keys(BLOCKS).filter(t => !corpusTypes.has(t));
  if (uncovered.length) {
    return { ok: false, name, checks, warnings, errors: [
      `the demo corpus does not cover block type(s): ${uncovered.join(', ')} — extend SHOWCASE_BLOCKS in engine/lib/bpcheck.js (Tier B checklist)`,
    ] };
  }

  const insideThemes = path.dirname(dir) === THEMES_DIR;
  const effectiveName = insideThemes ? name : TEMP_THEME;
  const tempThemeDir = path.join(THEMES_DIR, TEMP_THEME);
  const clientDir = path.join(ROOT, 'clients', TEMP_CLIENT);
  try {
    if (!insideThemes) { rmrf(tempThemeDir); copyDir(dir, tempThemeDir); }
    demo.content.site.theme = effectiveName;
    rmrf(clientDir);
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'content.json'), JSON.stringify(demo.content, null, 2) + '\n', 'utf8');
    const b = bpcheck.build(TEMP_CLIENT);
    if (!b.ok) {
      errors.push(`the demo client failed to build under this theme:\n${b.out}`);
    } else {
      checks.push(`demo client (every blueprint × variant + all ${Object.keys(BLOCKS).length} block types) builds under this theme`);
    }

    // 7. Own-CSS themes: every block type's markup must be addressed.
    // The bar: at least one block-specific class from each renderer's
    // real output appears in the stylesheet (which hook is the theme's
    // choice — e.g. default styles .about-intro-body, not .about-intro).
    // BLOCK_CATALOG.md lists the full class set per block.
    if (ownCss && !errors.length) {
      const cssText = files.filter(f => f.endsWith('.css')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
      const uncoveredTypes = [];
      for (const blk of bpcheck.SHOWCASE_BLOCKS) {
        const classes = blockClasses(blk.type, blk.fields, demo.content.site);
        const styled = classes.some(cls => new RegExp(`\\.${cls}(?![\\w-])`).test(cssText));
        if (!styled) uncoveredTypes.push(`${blk.type} (none of: .${classes.join(', .')})`);
      }
      if (uncoveredTypes.length) {
        errors.push(`css/styles.css styles no class of these block types: ${uncoveredTypes.join('; ')}`);
      } else {
        checks.push('own stylesheet addresses every block type’s markup');
      }
    }
  } catch (e) {
    errors.push(`exception during coverage build: ${e.message}`);
  } finally {
    if (!insideThemes) rmrf(tempThemeDir);
    rmrf(clientDir);
    rmrf(path.join(ROOT, 'dist', TEMP_CLIENT));
  }

  return { ok: errors.length === 0, name, checks, errors, warnings };
}

module.exports = { checkTheme, requiredTokens, contrastRequirements };
