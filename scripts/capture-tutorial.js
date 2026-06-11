#!/usr/bin/env node
/**
 * capture-tutorial.js — reusable screenshot/animation harness for the
 * Blockson tutorials. It executes a FLOW SPEC (an ordered list of steps)
 * against a headless Chromium and writes numbered captures, so a future
 * flow (e.g. the owner workflow) is one new spec file, not a new harness.
 *
 *   node scripts/capture-tutorial.js scripts/flows/developer-site.js
 *   node scripts/capture-tutorial.js <flow-file> --only <step-slug>
 *
 * A flow spec module exports:
 *   {
 *     name:   'developer-site',
 *     outDir: 'docs/tutorial/developer/img',     // repo-root-relative
 *     serve:  { root: 'dist/wren-and-willow' },  // optional static server
 *     setup:  async (ctx) => {},                 // optional, once, first
 *     teardown: async (ctx) => {},               // optional, once, last (always runs)
 *     steps: [{
 *       slug:        'home',                     // filename stem
 *       description: 'Homepage, both viewports', // goes into manifest.json
 *       viewports:   ['desktop', 'mobile'],      // default: both
 *       capture:     'fullpage',                 // 'fullpage' | 'viewport' | 'animation' | 'none'
 *       action:      async ({ page, baseUrl }) => { await page.goto(baseUrl + '/'); },
 *       animate:     async ({ page, frame }) => {},  // animation steps only:
 *                    // drive the page, calling `await frame()` at each
 *                    // moment worth a frame.
 *     }]
 *   }
 *
 * Output files: NN-<slug>--<viewport>.png (or .gif / NN-<slug>--<viewport>-fNN.png
 * frames when no GIF-capable ffmpeg exists). A manifest.json maps files to
 * step descriptions for tutorial assembly.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon',
};

/* Minimal static file server (stdlib only), confined to its root. */
function startStaticServer(rootDir) {
  const root = path.resolve(ROOT, rootDir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}

/* Find an ffmpeg that can actually encode GIFs (Playwright's bundled one
   cannot — it is a minimal webm-mux build). Returns a path or null. */
function findGifFfmpeg() {
  for (const candidate of ['ffmpeg']) {
    try {
      const out = execFileSync(candidate, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/\bgif\b/.test(out)) return candidate;
    } catch { /* not on PATH */ }
  }
  return null;
}

/* Assemble numbered frame PNGs into a GIF (palette two-pass for quality). */
function framesToGif(ffmpeg, framePattern, outFile, fps) {
  const r = spawnSync(ffmpeg, [
    '-y', '-framerate', String(fps), '-i', framePattern,
    '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer',
    outFile,
  ], { stdio: 'ignore' });
  return r.status === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const flowFile = args.find(a => !a.startsWith('--'));
  if (!flowFile) {
    console.error('Usage: node scripts/capture-tutorial.js <flow-file> [--only <step-slug>]');
    process.exit(1);
  }
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const flow = require(path.resolve(ROOT, flowFile));

  const outDir = path.resolve(ROOT, flow.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const ffmpeg = findGifFfmpeg();
  const server = flow.serve ? await startStaticServer(flow.serve.root) : null;
  const browser = await chromium.launch();
  const manifest = { flow: flow.name, generated: new Date().toISOString(), captures: [] };
  const baseCtx = { browser, baseUrl: server ? server.url : null, root: ROOT };

  try {
    if (flow.setup) await flow.setup(baseCtx);

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      if (only && step.slug !== only) continue;
      const nn = String(i + 1).padStart(2, '0');
      const viewports = step.viewports || ['desktop', 'mobile'];

      for (const vp of viewports) {
        const context = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: 2 });
        const page = await context.newPage();
        const ctx = { ...baseCtx, page, context, viewport: vp };
        const stem = `${nn}-${step.slug}--${vp}`;

        try {
          if (step.capture === 'animation') {
            // Frame-driven: the step calls frame() at each moment worth
            // keeping; we assemble a GIF if a capable ffmpeg exists, and
            // otherwise ship the frame sequence itself.
            const frameDir = path.join(outDir, `_frames-${stem}`);
            fs.mkdirSync(frameDir, { recursive: true });
            let n = 0;
            const frame = async () => {
              await page.screenshot({ path: path.join(frameDir, `f${String(n++).padStart(2, '0')}.png`) });
            };
            if (step.action) await step.action(ctx);
            await step.animate({ ...ctx, frame });
            let produced;
            if (ffmpeg && framesToGif(ffmpeg, path.join(frameDir, 'f%02d.png'), path.join(outDir, `${stem}.gif`), step.fps || 2)) {
              fs.rmSync(frameDir, { recursive: true, force: true });
              produced = `${stem}.gif`;
            } else {
              // Fallback: promote frames to first-class numbered captures.
              const frames = fs.readdirSync(frameDir).sort();
              frames.forEach(f => fs.renameSync(path.join(frameDir, f), path.join(outDir, `${stem}-${f}`)));
              fs.rmSync(frameDir, { recursive: true, force: true });
              produced = `${stem}-f00.png … (${frames.length} frames; no GIF-capable ffmpeg found)`;
            }
            manifest.captures.push({ file: produced, step: step.slug, viewport: vp, description: step.description });
          } else {
            if (step.action) await step.action(ctx);
            if (step.capture !== 'none') {
              await page.waitForLoadState('networkidle');
              if (step.settle !== false) {
                // The theme reveals .fade-in sections on intersection; a
                // static capture must not show them mid-hide. Force them
                // visible and let the CSS transition finish.
                await page.evaluate(() => {
                  document.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible'));
                }).catch(() => {});
                await page.waitForTimeout(800);
              }
              await page.screenshot({ path: path.join(outDir, `${stem}.png`), fullPage: step.capture === 'fullpage' });
              manifest.captures.push({ file: `${stem}.png`, step: step.slug, viewport: vp, description: step.description });
            }
          }
          console.log(`✓ ${stem}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    if (flow.teardown) await flow.teardown(baseCtx).catch(e => console.error('teardown:', e.message));
    await browser.close();
    if (server) server.close();
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${manifest.captures.length} capture(s) → ${path.relative(ROOT, outDir)}/ (manifest.json updated)`);
  if (!ffmpeg) console.log('Note: no GIF-capable ffmpeg on PATH — animation steps fall back to frame sequences.');
}

main().catch(e => { console.error(e); process.exit(1); });
