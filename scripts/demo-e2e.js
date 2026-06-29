#!/usr/bin/env node
/**
 * demo-e2e.js — browser test for the no-install browser DEMO of the owner
 * editor (engine/build-demo.js → dist/demo-<client>/). The Node proof suite
 * proves the in-memory host drives owner.js (proof 28); this proves the whole
 * demo runs as a static page with NO Node and NO server behind it: the same
 * ui.js, an in-page transport over a BrowserHost, the preview rendered in the
 * browser and fed to the iframe via srcdoc.
 *
 *   node scripts/demo-e2e.js          # or: npm run test:demo
 *
 * It builds the demo, serves the static folder, and drives real clicks through
 * the editor exactly as an owner would, asserting:
 *   - click-to-edit text: a click in the preview opens the field editor with
 *     the current value;
 *   - edit → pending: saving shows the before→after review and updates the
 *     live preview;
 *   - keep → staged, with PUBLISH VISIBLY DISABLED (the one thing the demo
 *     removes — nothing can go live);
 *   - image upload rides the in-browser image guards (the Buffer/signature
 *     path) and assigns an img/ path;
 *   - discard-all returns the preview to the seed;
 *   - a reload starts a FRESH session (the demo is ephemeral).
 *
 * Standalone (not part of `npm test`) because it needs a browser; requires the
 * Playwright Chromium the other browser smokes already depend on.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = 'example-restaurant';
const DEMO_DIR = path.join('dist', 'demo-' + CLIENT);

// A real 1×1 PNG (valid signature) for the upload path.
const PNG_1PX_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

function buildDemo() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'build-demo.js'), CLIENT],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build-demo failed:\n${r.stdout}${r.stderr}`);
}

function startStaticServer(rootDir) {
  const root = path.resolve(ROOT, rootDir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
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

// The preview iframe's frame (srcdoc), once it has rendered the page.
async function previewFrame(page) {
  const handle = await page.waitForSelector('#preview');
  await page.waitForFunction(() => {
    const f = document.getElementById('preview');
    const d = f && f.contentDocument;
    return d && d.querySelector('.hero h1');
  }, { timeout: 10000 });
  return handle.contentFrame();
}

// Dispatch a real click on a selector inside the preview frame; the overlay
// intercepts it and posts to the parent editor app.
async function clickInPreview(frame, sel) {
  return frame.evaluate((sel) => {
    const t = document.querySelector(sel);
    if (!t) return { error: 'not found: ' + sel };
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { ok: true };
  }, sel);
}

async function main() {
  buildDemo();
  const server = await startStaticServer(DEMO_DIR);
  const browser = await chromium.launch();
  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };

  // A temp PNG for the upload input.
  const tmpPng = path.join(os.tmpdir(), 'demo-portrait.png');
  fs.writeFileSync(tmpPng, Buffer.from(PNG_1PX_B64, 'base64'));

  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(server.url + '/index.html', { waitUntil: 'load' });

    // (a) The app booted from a static page: client name populated, preview rendered.
    await page.waitForFunction(() => {
      const n = document.getElementById('client-name');
      return n && n.textContent && n.textContent !== '…';
    }, { timeout: 10000 });
    let frame = await previewFrame(page);
    const originalHeadline = await frame.evaluate(() => document.querySelector('.hero h1').textContent.trim());
    expect(!!originalHeadline, 'preview hero headline did not render');

    // (b) Click the headline → the text editor opens with the current value.
    let c = await clickInPreview(frame, '.hero h1');
    expect(!c.error, `headline click: ${c.error || ''}`);
    await page.waitForFunction(() => {
      const ed = document.getElementById('editor');
      return ed && !ed.hidden && ed.querySelector('input');
    }, { timeout: 5000 });
    const editorValue = await page.$eval('#editor input', i => i.value);
    expect(editorValue === originalHeadline,
      `editor opened with "${editorValue}", expected the current headline "${originalHeadline}"`);

    // (c) Edit + Save → the before→after review shows, and the preview updates.
    const NEW_HEADLINE = 'Wood-fired, every winter night.';
    await page.$eval('#editor input', (i, v) => { i.value = v; }, NEW_HEADLINE);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#editor button')];
      (btns.find(b => /save/i.test(b.textContent)) || {}).click && btns.find(b => /save/i.test(b.textContent)).click();
    });
    await page.waitForFunction((nv) => {
      const ed = document.getElementById('editor');
      return ed && ed.textContent.includes(nv);   // the inline pending "After" value
    }, NEW_HEADLINE, { timeout: 5000 });
    // Preview rebuilt in-browser and reloaded via srcdoc.
    frame = await previewFrame(page);
    await page.waitForFunction(() => true);
    const previewAfter = await frame.evaluate(() => document.querySelector('.hero h1').textContent.trim());
    expect(previewAfter === NEW_HEADLINE,
      `the live preview shows "${previewAfter}", expected the edited "${NEW_HEADLINE}"`);

    // (d) Keep → the change is staged, and Publish is visibly DISABLED.
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const keep = [...ed.querySelectorAll('button')].find(b => /^keep$/i.test(b.textContent.trim()));
      keep.click();
    });
    await page.waitForFunction(() => {
      const s = document.getElementById('session-card');
      return s && !s.hidden && document.querySelectorAll('#staged-list .staged-row').length === 1;
    }, { timeout: 5000 });
    const publishDisabled = await page.$eval('#btn-publish', b => b.disabled);
    const publishText = await page.$eval('#btn-publish', b => b.textContent);
    const restoreHidden = await page.$eval('#btn-restore', b => b.hidden);
    expect(publishDisabled, 'the Publish button is NOT disabled in the demo (publishing must be off)');
    expect(/off in this demo/i.test(publishText), `Publish button text "${publishText}" does not say publishing is off`);
    expect(restoreHidden, 'the "Undo last publish" control is shown in the demo (should be hidden)');

    // (e) Image upload rides the in-browser guards (Buffer/signature) and is
    //     assigned an img/ path. Click the hero background (dead-space resolves
    //     to it) to open the image editor, choose the PNG, and use it.
    const heroBgClick = await frame.evaluate(() => {
      // The annotated hero carries a data-bk-bg child; click it directly.
      const bg = document.querySelector('[data-bk-bg]');
      if (!bg) return { error: 'no data-bk-bg in preview' };
      bg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { ok: true };
    });
    if (heroBgClick.error) {
      expect(false, `hero background click: ${heroBgClick.error}`);
    } else {
      await page.waitForFunction(() => {
        const ed = document.getElementById('editor');
        return ed && !ed.hidden && ed.querySelector('input[type=file]');
      }, { timeout: 5000 });
      await page.setInputFiles('#editor input[type=file]', tmpPng);
      await page.evaluate(() => {
        const ed = document.getElementById('editor');
        const use = [...ed.querySelectorAll('button')].find(b => /use this image/i.test(b.textContent));
        use.click();
      });
      // The pending review names the engine-assigned img/ path.
      await page.waitForFunction(() => {
        const ed = document.getElementById('editor');
        return ed && /img\/demo-portrait/.test(ed.textContent);
      }, { timeout: 5000 }).catch(() => {});
      const sawImgPath = await page.$eval('#editor', ed => /img\/demo-portrait/.test(ed.textContent)).catch(() => false);
      expect(sawImgPath, 'the uploaded image was not accepted / assigned an img/ path in the demo');
      // Discard this pending image change so the session is just the headline.
      await page.evaluate(() => {
        const ed = document.getElementById('editor');
        const d = [...ed.querySelectorAll('button')].find(b => /^discard$/i.test(b.textContent.trim()));
        if (d) d.click();
      });
    }

    // (f) Discard all → the preview returns to the seed.
    page.on('dialog', d => d.accept());
    await page.click('#btn-discard-all');
    await page.waitForFunction(() => {
      const s = document.getElementById('session-card');
      return s && s.hidden;
    }, { timeout: 5000 });
    frame = await previewFrame(page);
    const headlineAfterDiscard = await frame.evaluate(() => document.querySelector('.hero h1').textContent.trim());
    expect(headlineAfterDiscard === originalHeadline,
      `after discard-all the preview shows "${headlineAfterDiscard}", expected the seed "${originalHeadline}"`);

    // (g) A reload is a FRESH session (ephemeral): nothing staged, seed content.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => {
      const n = document.getElementById('client-name');
      return n && n.textContent && n.textContent !== '…';
    }, { timeout: 10000 });
    const stagedAfterReload = await page.$$eval('#staged-list .staged-row', rows => rows.length);
    expect(stagedAfterReload === 0, `a reload kept ${stagedAfterReload} staged change(s) — the demo must start fresh`);

    expect(errors.length === 0, `uncaught page errors: ${errors.join(' | ')}`);
    await context.close();
  } catch (e) {
    failures.push(`exception: ${e.stack || e.message}`);
  } finally {
    await browser.close();
    server.close();
    try { fs.unlinkSync(tmpPng); } catch (e) {}
  }

  console.log('\n═══ DEMO E2E — the static browser demo runs the owner editor with no Node and no server ═══');
  if (failures.length === 0) {
    console.log('PASS — the demo build boots from a static page, opens the field editor on a');
    console.log('       click, shows before→after and updates the in-browser preview, stages a');
    console.log('       kept change with PUBLISH VISIBLY DISABLED, accepts an image upload through');
    console.log('       the same guards and assigns an img/ path, returns to the seed on');
    console.log('       discard-all, and starts a fresh session on reload.');
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
