#!/usr/bin/env node
/* ============================================================
   engine/build-demo.js — Static browser-demo builder (Phase 2)

     node engine/build-demo.js <client>

   Emits a self-contained static demo of the owner editor for one client to
   dist/demo-<client>/ — a folder you can open on any static host (GitHub Pages,
   an S3 bucket, a file server) with NO Node and NO server. It is the onboarding
   centerpiece: a link a developer sends a prospect to try click-to-edit against
   a site matching their real deliverable, with Publish disabled.

   It does two things:
     1. Inlines everything the engine reads from disk into ./ui/demo/
        seed.generated.js — the client's content.json + img/ (base64), the
        active theme's tokens/CSS/JS, the click-to-edit overlay source, the
        content schema, and the validated blueprint registry.
     2. Bundles engine/ui/demo/entry.js (→ owner.js → validate/scaffold + ajv)
        with esbuild into one browser script, aliasing the Node built-ins that
        get pulled in transitively but are never called in the browser
        (fs/child_process → empty, path → a tiny shim) and injecting a minimal
        Buffer shim for the image-upload guards.

   The output is the unchanged editor shell + ui.js + ui.css + the bundle. The
   demo removes Publish (a host no-op) and relaxes no guard: every edit still
   flows through applyPatch and the same candidate build gate as on Node.

   Downstream (which client is seeded, and the static deploy) is the client
   repo's job; this script only produces the folder.
   ============================================================ */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const client = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!client) {
  console.error('Usage: node engine/build-demo.js <client>');
  process.exit(1);
}
if (!/^[a-zA-Z0-9_-]+$/.test(client)) {
  console.error(`Invalid client name "${client}"`);
  process.exit(1);
}

const clientDir = path.join(ROOT, 'clients', client);
const contentPath = path.join(clientDir, 'content.json');
if (!fs.existsSync(contentPath)) {
  console.error(`Error: ${contentPath} not found`);
  process.exit(1);
}

// ── Gather the seed ────────────────────────────────────────────
const contentText = fs.readFileSync(contentPath, 'utf8');
let content;
try { content = JSON.parse(contentText); }
catch (e) { console.error(`Error: content.json is not valid JSON — ${e.message}`); process.exit(1); }

const theme = (content.site && content.site.theme) || 'default';

let clientName = client;
const cfgPath = path.join(clientDir, 'owner-config.json');
if (fs.existsSync(cfgPath)) {
  try { clientName = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).clientName || client; } catch (e) {}
}

// Theme tokens (preset values; client overrides are merged at render time).
const tokensPath = path.join(ROOT, 'themes', theme, 'tokens.json');
const tokens = fs.existsSync(tokensPath) ? JSON.parse(fs.readFileSync(tokensPath, 'utf8')) : null;

// Theme CSS — resolved exactly as engine/build.js does: the theme's own css/
// if present, else the cssBase declared in tokens.json, else default. The
// linked stylesheet is styles.css; inline every .css in that dir to be safe.
function readCssDir(dir) {
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.css'))
    .sort((a, b) => (a === 'styles.css' ? -1 : b === 'styles.css' ? 1 : a.localeCompare(b)))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}
let cssDir = path.join(ROOT, 'themes', theme, 'css');
if (!fs.existsSync(cssDir)) {
  const cssBase = (tokens && tokens.cssBase) || 'default';
  cssDir = path.join(ROOT, 'themes', cssBase, 'css');
}
const css = readCssDir(cssDir);

// Theme JS — the footer links js/main.js; default is the shared base, a theme
// override (same filename) wins. That single file is what gets inlined.
let jsPath = path.join(ROOT, 'themes', 'default', 'js', 'main.js');
const themeJsPath = path.join(ROOT, 'themes', theme, 'js', 'main.js');
if (theme !== 'default' && fs.existsSync(themeJsPath)) jsPath = themeJsPath;
const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';

const overlay = fs.readFileSync(path.join(ROOT, 'engine', 'ui', 'overlay.js'), 'utf8');
const schema  = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'schema', 'content.schema.json'), 'utf8'));
const blueprints = require('./lib/scaffold').loadBlueprints();

// Client images → { "<path under img/>": "<base64>" }.
const images = {};
const imgDir = path.join(clientDir, 'img');
if (fs.existsSync(imgDir)) {
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), r);
      else images[r] = fs.readFileSync(path.join(dir, entry.name)).toString('base64');
    }
  })(imgDir, '');
}

// ── Write the seed module the entry imports ────────────────────
const seed = { clientName, content: contentText, theme: { tokens, css, js, overlay }, schema, blueprints, images };
const seedPath = path.join(ROOT, 'engine', 'ui', 'demo', 'seed.generated.js');
fs.writeFileSync(seedPath,
  '/* AUTO-GENERATED by engine/build-demo.js — do not edit, do not commit. */\n' +
  'module.exports = ' + JSON.stringify(seed) + ';\n', 'utf8');

// ── Bundle + assemble the static folder ────────────────────────
const outDir = path.join(ROOT, 'dist', 'demo-' + client);
const shims = path.join(ROOT, 'engine', 'ui', 'demo', 'shims');

require('esbuild').build({
  entryPoints: [path.join(ROOT, 'engine', 'ui', 'demo', 'entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2018'],
  outfile: path.join(outDir, 'demo-bundle.js'),
  define: { __dirname: JSON.stringify('/'), __filename: JSON.stringify('/demo.js') },
  alias: {
    fs: path.join(shims, 'empty.js'),
    child_process: path.join(shims, 'empty.js'),
    path: path.join(shims, 'path.js'),
  },
  inject: [path.join(shims, 'buffer-inject.js')],
  legalComments: 'none',
  logLevel: 'warning',
}).then(() => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'engine', 'ui', 'demo', 'index.html'), path.join(outDir, 'index.html'));
  fs.copyFileSync(path.join(ROOT, 'engine', 'ui', 'ui.js'),  path.join(outDir, 'ui.js'));
  fs.copyFileSync(path.join(ROOT, 'engine', 'ui', 'help.js'), path.join(outDir, 'help.js'));
  fs.copyFileSync(path.join(ROOT, 'engine', 'ui', 'ui.css'), path.join(outDir, 'ui.css'));
  const pageCount = (content.pages || []).length;
  console.log(`Built browser demo → dist/demo-${client}/  (${pageCount} page(s), ${Object.keys(images).length} image(s))`);
  console.log('  Open dist/demo-' + client + '/index.html on any static host (no Node, no server).');
}).catch(err => {
  console.error('Demo bundle failed:');
  console.error(err.message || err);
  process.exit(1);
});
