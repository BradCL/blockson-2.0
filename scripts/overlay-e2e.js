#!/usr/bin/env node
/**
 * overlay-e2e.js — browser test for the click-to-edit overlay's target
 * resolution (engine/ui/overlay.js), the one piece the Node proof suite
 * cannot reach because it is DOM logic that runs in a real page.
 *
 *   node scripts/overlay-e2e.js          # or: npm run test:overlay
 *
 * It builds example-restaurant (a hero on the home page, an explicit-
 * background page-header on the menu page), serves the annotated build,
 * injects the actual overlay.js into each page, and drives real clicks —
 * asserting the (block, field) reference the overlay posts to its parent:
 *   - a dead-space click in a hero / page-header resolves to the section
 *     BACKGROUND (the behind-content target `closest` can't reach), which
 *     is where the image-replace + focal/zoom editor opens;
 *   - a click on a specific content element (the hero headline) still
 *     resolves to that element — the fallback never steals a real target;
 *   - the SAME overlay on the LIVE build posts nothing, because a live page
 *     carries no annotations or markers (the preview-only invariant).
 *
 * Standalone (not part of `npm test`) because it needs a browser; requires
 * the Playwright Chromium that capture-tutorial.js already depends on.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = 'example-restaurant';
const OVERLAY = fs.readFileSync(path.join(ROOT, 'engine', 'ui', 'overlay.js'), 'utf8');

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon',
};

function build(extra) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'build.js'), CLIENT, ...(extra || [])],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build ${CLIENT} ${(extra || []).join(' ')} failed:\n${r.stdout}${r.stderr}`);
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

// Open a page, inject the real overlay, and start collecting the bk-edit
// references it posts. The overlay posts to window.parent; this page is
// top-level, so parent === self and its own message listener receives them.
async function openWithOverlay(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.addScriptTag({ content: OVERLAY });
  await page.evaluate(() => {
    window.__bk = [];
    window.addEventListener('message', (e) => {
      if (e.data && (e.data.type === 'bk-edit' || e.data.type === 'bk-section')) window.__bk.push(e.data);
    });
  });
  return { context, page };
}

// Dispatch a real click on the element that hit-testing finds at a point in a
// section's dead space (a band below its centered content), then return the
// last bk-edit reference the overlay posted.
async function clickDeadSpace(page, sectionSel, contentSel) {
  return page.evaluate(async ({ sectionSel, contentSel }) => {
    const sec = document.querySelector(sectionSel);
    const content = document.querySelector(contentSel);
    if (!sec || !content) return { error: 'section/content not found' };
    const sr = sec.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    const x = Math.round(sr.left + sr.width / 2);
    const y = Math.round(cr.bottom + Math.max(8, (sr.bottom - cr.bottom) / 2));
    const target = document.elementFromPoint(x, y);
    if (!target) return { error: 'no element at the dead-space point' };
    window.__bk.length = 0;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    await new Promise((r) => setTimeout(r, 50)); // postMessage delivers async
    return { ok: true, posted: window.__bk.slice(), targetTag: target.tagName };
  }, { sectionSel, contentSel });
}

// Hover a section (to reveal the overlay's per-section chip), then click the
// chip and return whether it showed and what it posted.
async function hoverSectionClickChip(page, innerSel) {
  return page.evaluate(async (innerSel) => {
    const inner = document.querySelector(innerSel);
    if (!inner) return { error: 'inner element not found: ' + innerSel };
    inner.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const chip = document.querySelector('.bk-section-chip');
    const shown = !!(chip && chip.style.display !== 'none');
    window.__bk.length = 0;
    if (chip) chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50)); // postMessage delivers async
    return { ok: true, shown, posted: window.__bk.slice() };
  }, innerSel);
}

async function clickSelector(page, sel) {
  return page.evaluate(async (sel) => {
    const target = document.querySelector(sel);
    if (!target) return { error: 'selector not found: ' + sel };
    window.__bk.length = 0;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50)); // postMessage delivers async
    return { ok: true, posted: window.__bk.slice() };
  }, sel);
}

async function main() {
  build(['--annotate']);
  build();

  const annServer = await startStaticServer(`dist/${CLIENT}__annotated`);
  const liveServer = await startStaticServer(`dist/${CLIENT}`);
  const browser = await chromium.launch();
  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };

  try {
    // (a) ANNOTATED home: a dead-space hero click resolves to the hero
    //     background field — the behind-content target a plain `closest` misses.
    {
      const { context, page } = await openWithOverlay(browser, annServer.url + '/index.html');
      const r = await clickDeadSpace(page, '.hero', '.hero-content');
      if (r.error) expect(false, `hero dead-space: ${r.error}`);
      else {
        const msg = r.posted[0];
        expect(r.posted.length === 1, `hero dead-space posted ${r.posted.length} refs, expected 1`);
        expect(msg && msg.field === 'background', `hero dead-space resolved to field "${msg && msg.field}", expected "background"`);
        expect(msg && typeof msg.block === 'string' && msg.block, 'hero dead-space ref carries no block id');
      }

      // (b) A click ON the hero headline still resolves to that element — the
      //     background fallback must never steal a more specific target.
      const h = await clickSelector(page, '.hero h1');
      if (h.error) expect(false, `hero headline: ${h.error}`);
      else expect(h.posted[0] && h.posted[0].field === 'headline',
        `hero headline resolved to "${h.posted[0] && h.posted[0].field}", expected "headline"`);

      // (b2) Hovering the hero reveals the per-section chip; clicking it posts a
      //      bk-section ref carrying the hero block id (the doorway to the
      //      Section panel), distinct from the per-element bk-edit path.
      const chip = await hoverSectionClickChip(page, '.hero h1');
      if (chip.error) expect(false, `hero chip: ${chip.error}`);
      else {
        expect(chip.shown, 'the section chip was not revealed on hero hover');
        expect(chip.posted.length === 1 && chip.posted[0].type === 'bk-section',
          `hero chip posted ${JSON.stringify(chip.posted)}, expected one bk-section`);
        expect(chip.posted[0] && typeof chip.posted[0].block === 'string' && chip.posted[0].block,
          'hero chip bk-section ref carries no block id');
      }
      await context.close();
    }

    // (c) ANNOTATED menu: a dead-space click in the EXPLICIT-background
    //     page-header resolves to its background field (not the variant field
    //     the click used to land on).
    {
      const { context, page } = await openWithOverlay(browser, annServer.url + '/menu.html');
      const r = await clickDeadSpace(page, 'header.page-header', '.page-header-content');
      if (r.error) expect(false, `page-header dead-space: ${r.error}`);
      else {
        const msg = r.posted[0];
        expect(r.posted.length === 1, `page-header dead-space posted ${r.posted.length} refs, expected 1`);
        expect(msg && msg.field === 'background', `page-header dead-space resolved to "${msg && msg.field}", expected "background"`);
      }
      await context.close();
    }

    // (d) The SAME overlay on the LIVE build posts nothing: a live page carries
    //     no annotations and no data-bk-bg marker, so a dead-space click has
    //     nothing to resolve to (preview-only invariant, end to end).
    {
      const { context, page } = await openWithOverlay(browser, liveServer.url + '/index.html');
      const hasMarker = await page.evaluate(() => document.querySelector('[data-bk-bg]') !== null
        || document.querySelector('[data-bk-block]') !== null);
      expect(!hasMarker, 'live build page carries data-bk-* attributes (must be annotated-only)');
      const r = await clickDeadSpace(page, '.hero', '.hero-content');
      if (!r.error) expect(r.posted.length === 0, `live dead-space posted ${r.posted.length} refs, expected 0`);
      // The section chip never resolves on a live page (no data-bk-bg), so it
      // never shows and never posts — the doorway is preview-only too.
      const chip = await hoverSectionClickChip(page, '.hero h1');
      if (!chip.error) {
        expect(!chip.shown, 'the section chip showed on a live build page (must be preview-only)');
        expect(chip.posted.length === 0, `live section chip posted ${chip.posted.length} refs, expected 0`);
      }
      await context.close();
    }
  } catch (e) {
    failures.push(`exception: ${e.message}`);
  } finally {
    await browser.close();
    annServer.close();
    liveServer.close();
  }

  console.log('\n═══ OVERLAY E2E — dead-space clicks reach section backgrounds; hover chip opens the Section panel; live posts nothing ═══');
  if (failures.length === 0) {
    console.log('PASS — a dead-space click in a hero and in an explicit-background page-header');
    console.log('       both resolve to the section background field (where image-replace +');
    console.log('       focal/zoom open); a click on the hero headline still resolves to the');
    console.log('       headline; hovering a section reveals the chip whose click posts a');
    console.log('       bk-section ref with the block id; and the same overlay on the live build');
    console.log('       neither resolves a background nor shows the chip — it posts nothing.');
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
