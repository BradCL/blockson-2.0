#!/usr/bin/env node
/**
 * gallery-e2e.js — browser test for the gallery's hash-driven category filter
 * (themes/default/js/main.js), the piece the Node proof suite cannot reach
 * because it is DOM + History behaviour that only exists in a real page.
 *
 *   node scripts/gallery-e2e.js          # or: npm run test:gallery
 *
 * Proof 42 asserts the CONTRACT between the renderer and the theme — that
 * every cover links to a fragment naming a real filter, that main.js agrees on
 * the prefix, that the [hidden] rule can outrank the grid's display. What it
 * cannot assert is that any of it actually runs. This does: it builds
 * example-contractor (a gallery in `categories` mode), serves it, and drives
 * real clicks and real history navigation, asserting
 *   - a fresh load shows the covers and no album cards;
 *   - clicking a cover switches to that category — the affordance working end
 *     to end;
 *   - BACK returns to the overview, which is the push-history decision in
 *     main.js paying off (and the behaviour that was simply broken before the
 *     filter had URL state at all);
 *   - a pasted deep link lands on its category, the case an ad campaign needs;
 *   - an unknown category and a foreign fragment both fall back to the
 *     overview rather than blanking the grid;
 *   - a tab click writes the hash too, so every view is shareable;
 *   - a card revealed by filtering is not stranded at opacity 0 by the
 *     fade-in observer that saw it while it was display:none.
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
const CLIENT = 'example-contractor';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon',
};

function build() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'build.js'), CLIENT],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build ${CLIENT} failed:\n${r.stdout}${r.stderr}`);
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

// hashchange delivers asynchronously and the fade-in transition runs ~0.55s,
// so every assertion samples the page only after it has settled. Reading
// immediately after a click races the handler and reports the PREVIOUS view.
const SETTLE_MS = 700;

function readState(page) {
  return page.evaluate(() => ({
    hash: location.hash,
    coversVisible: !document.querySelector('.category-grid').hidden,
    visibleAlbums: [...document.querySelectorAll('.album-card')]
      .filter(c => getComputedStyle(c).display !== 'none')
      .map(c => c.getAttribute('data-title')),
    activeTab: (document.querySelector('.filter-btn.active') || {}).textContent,
    emptyShown: !document.getElementById('gallery-empty').hidden,
    // Opacity of the first visible album card: the fade-in observer saw these
    // while they were display:none, and must re-fire when one is revealed.
    firstOpacity: (() => {
      const c = [...document.querySelectorAll('.album-card')]
        .find(c => getComputedStyle(c).display !== 'none');
      return c ? getComputedStyle(c).opacity : null;
    })(),
  }));
}

async function main() {
  build();
  const server = await startStaticServer(path.join('dist', CLIENT));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  const gallery = `${server.url}/gallery.html`;
  const settle = () => page.waitForTimeout(SETTLE_MS);

  try {
    // The fixture has to actually be in categories mode, or every assertion
    // below passes vacuously.
    await page.goto(gallery, { waitUntil: 'load' });
    if (!await page.evaluate(() => !!document.querySelector('.category-grid'))) {
      throw new Error(`${CLIENT}'s gallery is not in "categories" mode — this test would pass without testing anything`);
    }

    // 1. Fresh load: the overview IS the covers.
    await settle();
    let s = await readState(page);
    check(s.coversVisible, 'a fresh load did not show the category covers');
    check(s.visibleAlbums.length === 0, `album cards were visible on the overview: ${s.visibleAlbums.join(', ')}`);
    check(s.activeTab === 'All', `the active tab on load was "${s.activeTab}", not "All"`);
    check(!s.emptyShown, 'the "no projects match" message showed on a populated overview');

    // 2. The affordance, end to end: a cover goes to its category.
    await page.click('a.category-card[href="#category-bathroom"]');
    await settle();
    s = await readState(page);
    check(s.hash === '#category-bathroom', `clicking a cover left the hash at "${s.hash}"`);
    check(!s.coversVisible, 'the covers stayed visible on a category tab');
    check(s.activeTab === 'Bathroom', `the cover click left the active tab at "${s.activeTab}"`);
    check(s.visibleAlbums.length === 1, `the bathroom tab showed ${s.visibleAlbums.length} album(s), expected 1`);

    // 3. …and a card revealed by that filter faded in rather than arriving
    //    stuck at opacity 0 (it was display:none when the observer first saw it).
    check(s.firstOpacity === '1', `a revealed album card sits at opacity ${s.firstOpacity} — the fade-in observer never re-fired`);

    // 4. BACK returns to the overview. This is the push-history choice in
    //    main.js, and the behaviour that did not exist before the filter had
    //    URL state: filtering used to leave Back pointing off the page.
    await page.goBack();
    await settle();
    s = await readState(page);
    check(s.coversVisible, 'Back did not return to the category overview');
    check(s.visibleAlbums.length === 0, 'album cards were still visible after Back');

    // 5. A pasted deep link lands on its category — the ad-campaign case.
    await page.goto(`${gallery}#category-framing`, { waitUntil: 'load' });
    await settle();
    s = await readState(page);
    check(!s.coversVisible, 'a deep link did not leave the overview');
    check(s.activeTab === 'Framing', `a deep link left the active tab at "${s.activeTab}"`);
    check(s.visibleAlbums.length >= 1, 'a deep link showed no albums');

    // 6. A retired category and a fragment belonging to something else both
    //    resolve to the overview. A stale link must not blank the grid.
    for (const [frag, what] of [['#category-nosuchthing', 'an unknown category'], ['#contact', 'a foreign fragment']]) {
      await page.goto(gallery + frag, { waitUntil: 'load' });
      await settle();
      s = await readState(page);
      check(s.coversVisible, `${what} did not fall back to the overview`);
    }

    // 7. Tab clicks write the hash too, so any view a visitor reaches by
    //    clicking is a view they can send to someone.
    await page.goto(gallery, { waitUntil: 'load' });
    await page.click('.filter-btn[data-filter="exterior"]');
    await settle();
    s = await readState(page);
    check(s.hash === '#category-exterior', `a tab click left the hash at "${s.hash}"`);
    check(s.activeTab === 'Exterior', `a tab click left the active tab at "${s.activeTab}"`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n═══ GALLERY E2E — the hash drives the filter; covers navigate; Back returns to the overview ═══');
  if (failures.length === 0) {
    console.log('PASS — a categories-mode gallery opens on its covers with no album cards;');
    console.log('       clicking a cover switches to that category and Back returns to the');
    console.log('       overview (the push-history decision, and behaviour that did not exist');
    console.log('       before the filter had URL state); a pasted #category- link lands on its');
    console.log('       tab, which is what makes a category an ad-campaign destination; an');
    console.log('       unknown category and a foreign fragment both fall back to the overview');
    console.log('       instead of blanking the grid; tab clicks write the hash so every view is');
    console.log('       shareable; and a card revealed by filtering fades in rather than');
    console.log('       arriving stuck at opacity 0.');
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(f => console.log(`       ✗ ${f}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
