#!/usr/bin/env node
/* ============================================================
   engine/build.js — Static site builder (Module A entry point)

   STRUCTURAL IMMUTABILITY CONTRACT
   This engine is intentionally "frozen" at the structure level.
   Content lives in content.json; structure lives here.
   They communicate only through a strict schema — the schema is
   the contract, and this file enforces it before a single byte
   is written to disk.

   Key invariants maintained here:
   - Validation + duplicate-id check happen BEFORE any file write.
     If either fails the process exits and dist/ is untouched.
   - All pages are rendered into memory first; dist/<client> is
     wiped and rewritten atomically. There are no partial builds.
   - Blocks are addressed by id, never by array index. IDs come
     from content.json and are validated for uniqueness here.
   - The maintenance tier (Module B) can only reach this builder
     through apply-patch.js, which auto-rolls back if the build
     fails — so a bad patch can never leave the site in a broken
     state.

   THEME SELECTION
   site.theme in content.json names the subdirectory under themes/.
   CSS is loaded from themes/<theme>/css/styles.css if that theme
   ships its own CSS; otherwise from the cssBase declared in its
   tokens.json (token-preset themes), falling back to default.
   JS is always loaded from themes/default/js/ as the shared base,
   then overlaid with themes/<theme>/js/ overrides if that directory
   exists. This keeps theme directories clean of duplicate JS.
   ============================================================ */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Resolve paths & flags ──────────────────────────────────────
const ROOT    = path.resolve(__dirname, '..');
const args    = process.argv.slice(2);
const annotate = args.includes('--annotate');
const clientName = args.find(a => !a.startsWith('--'));

if (!clientName) {
  console.error('Usage: node engine/build.js <client-name> [--annotate]');
  process.exit(1);
}

// An annotated build is a PREVIEW-ONLY artifact: it carries data-bk-* edit
// annotations and so must never be mistaken for, or deployed as, the live
// site. It is written to a clearly separate directory for that reason
// (the "live builds never contain annotations" invariant, enforced by path).
const distSuffix = annotate ? '__annotated' : '';

const clientDir  = path.join(ROOT, 'clients', clientName);
const contentPath = path.join(clientDir, 'content.json');

if (!fs.existsSync(contentPath)) {
  console.error(`Error: ${contentPath} not found`);
  process.exit(1);
}

// ── Step 1: Load & validate ────────────────────────────────────
let content;
try {
  content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
} catch (e) {
  console.error(`Error: content.json is not valid JSON — ${e.message}`);
  process.exit(1);
}

const { validate } = require('./lib/validate');
const result = validate(content);
if (result.warnings && result.warnings.length) {
  result.warnings.forEach(w => console.warn(`  ⚠ ${w}`));
}
if (!result.ok) {
  console.error('Validation failed:');
  result.errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}

// Check block ids are unique across all pages (patch resolver uses a flat map keyed by block id).
const blockIdErrors = checkBlockIdUniqueness(content);
if (blockIdErrors.length) {
  console.error('Content has duplicate block ids:');
  blockIdErrors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}

// Check for duplicate item ids within any block (ids are addressing handles).
const idErrors = checkItemIdUniqueness(content);
if (idErrors.length) {
  console.error('Content has duplicate item ids:');
  idErrors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}

// ── Step 2: Assemble HTML into memory (no partial writes) ──────
const { renderPage } = require('./lib/render');
const site  = content.site;
const theme = site.theme || 'default';

// Resolve theme tokens: preset values merged with any client overrides.
const tokensPath = path.join(ROOT, 'themes', theme, 'tokens.json');
let resolvedTokens = null;
if (fs.existsSync(tokensPath)) {
  const preset = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  resolvedTokens = { ...preset, ...(site.themeOverrides || {}) };
} else {
  console.warn(`  ⚠ themes/${theme}/tokens.json not found — token injection skipped`);
}

// In annotate mode, build the edit-map-driven annotator once and thread it
// into every page render (engine/lib/annotate.js). Live builds pass nothing.
let annotator = null;
if (annotate) {
  const { buildAnnotator } = require('./lib/annotate');
  annotator = buildAnnotator(content, resolvedTokens);
}

const outputs = [];   // { destPath, content }

for (const page of content.pages) {
  let html;
  try {
    html = renderPage(page, site, resolvedTokens, annotator);
  } catch (e) {
    console.error(`Error rendering page "${page.slug}": ${e.message}`);
    process.exit(1);
  }
  const filename = page.slug === 'index' ? 'index.html' : `${page.slug}.html`;
  outputs.push({ destPath: filename, content: html });
}

// ── sitemap.xml ────────────────────────────────────────────────
const baseUrl = site.baseUrl.replace(/\/$/, '');
const sitemapUrls = content.pages.map(p => {
  const loc = p.slug === 'index'
    ? `${baseUrl}/`
    : `${baseUrl}/${p.slug}.html`;
  return `  <url><loc>${loc}</loc></url>`;
}).join('\n');

outputs.push({
  destPath: 'sitemap.xml',
  content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`
});

// ── robots.txt ────────────────────────────────────────────────
outputs.push({
  destPath: 'robots.txt',
  content: `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`
});

// ── Step 3: Write everything ───────────────────────────────────
const distDir = path.join(ROOT, 'dist', clientName + distSuffix);

// Wipe and recreate dist/<client>
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Write HTML / sitemap / robots
for (const out of outputs) {
  fs.writeFileSync(path.join(distDir, out.destPath), out.content, 'utf8');
}

// Copy theme css — use the theme's own css/ if present, otherwise fall back
// to the cssBase declared in tokens.json, then to the default theme.
const themeDir = path.join(ROOT, 'themes', theme);
const themeCssDir = path.join(themeDir, 'css');
if (fs.existsSync(themeCssDir)) {
  copyDir(themeCssDir, path.join(distDir, 'css'));
} else {
  const cssBase = (resolvedTokens && resolvedTokens.cssBase) || 'default';
  copyDir(path.join(ROOT, 'themes', cssBase, 'css'), path.join(distDir, 'css'));
}

// JS: always start from default as the shared base, then overlay theme-specific
// overrides if they exist. Keeps non-default theme dirs free of duplicate JS.
copyDir(path.join(ROOT, 'themes', 'default', 'js'), path.join(distDir, 'js'));
if (theme !== 'default') {
  copyDir(path.join(themeDir, 'js'), path.join(distDir, 'js'));
}

// Copy client img/
const imgSrc = path.join(clientDir, 'img');
if (fs.existsSync(imgSrc)) {
  copyDir(imgSrc, path.join(distDir, 'img'));
}

console.log(`Built ${content.pages.length} page(s) → dist/${clientName + distSuffix}/${annotate ? '  (annotated preview)' : ''}`);

// ── Image weight advisory ──────────────────────────────────────
// Page weight is the one quality problem a validating build can't see:
// a 5 MB phone photo copied verbatim into img/ ships a 5 MB page. Warn
// (stderr) about every heavy file and a heavy folder total. Advisory
// only — it never changes the exit code or the build output.
warnOnHeavyImages(imgSrc);

// ── Helpers ────────────────────────────────────────────────────
function warnOnHeavyImages(imgDir) {
  const PER_FILE_LIMIT = 500 * 1024;       // 500 KB per image
  const TOTAL_LIMIT    = 2 * 1024 * 1024;  // 2 MB for the whole img/ folder
  if (!fs.existsSync(imgDir)) return;
  const files = [];
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(p, r);
      else files.push({ rel: r, bytes: fs.statSync(p).size });
    }
  })(imgDir, '');
  const human = b => b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
  let total = 0;
  for (const f of files) {
    total += f.bytes;
    if (f.bytes > PER_FILE_LIMIT) {
      console.warn(`  ⚠ img/${f.rel} is ${human(f.bytes)} — every visitor downloads it at full size; resize it to ~1920 px on the longest edge and re-save before shipping.`);
    }
  }
  if (total > TOTAL_LIMIT) {
    console.warn(`  ⚠ img/ totals ${(total / 1048576).toFixed(1)} MB across ${files.length} files`);
  }
}

function checkBlockIdUniqueness(content) {
  const seen = new Map(); // blockId -> "page slug"
  const errors = [];
  for (const page of content.pages || []) {
    for (const block of page.blocks || []) {
      if (!block || typeof block.id !== 'string') continue;
      if (seen.has(block.id)) {
        errors.push(`block id "${block.id}" on page "${page.slug}" duplicates the one on page "${seen.get(block.id)}"`);
      } else {
        seen.set(block.id, page.slug);
      }
    }
  }
  return errors;
}

function checkItemIdUniqueness(content) {
  const errors = [];
  for (const page of content.pages || []) {
    for (const block of page.blocks || []) {
      const seen = new Set();
      (function collectIds(node) {
        if (Array.isArray(node)) {
          for (const el of node) collectIds(el);
        } else if (node && typeof node === 'object') {
          if (typeof node.id === 'string') {
            if (seen.has(node.id)) {
              errors.push(`duplicate item id "${node.id}" in block "${block.id}" (page "${page.slug}")`);
            }
            seen.add(node.id);
          }
          for (const k of Object.keys(node)) {
            if (k !== 'id') collectIds(node[k]);
          }
        }
      })(block.fields);
    }
  }
  return errors;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
