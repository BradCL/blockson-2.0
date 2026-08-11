#!/usr/bin/env node
/**
 * Browser regression for a legal-content block used as a standalone page.
 *
 * The navigation is fixed and paints through y=73. Generic mobile section
 * padding begins content at 3.4rem (54.4px), so a first-position legal heading
 * used to sit underneath it. This fixture proves the heading clears the nav at
 * 390px and desktop widths, while a legal block later on a page receives no
 * special inline clearance.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = '__legal-content-e2e';
const clientDir = path.join(ROOT, 'clients', CLIENT);
const distDir = path.join(ROOT, 'dist', CLIENT);

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.xml': 'application/xml', '.txt': 'text/plain',
};

function legalBlock(id) {
  return {
    id, type: 'legal-content', fields: {
      content: [
        { type: 'heading', level: 1, text: 'Privacy Policy' },
        { type: 'paragraph', content: [{ text: 'A standalone legal document.' }] },
      ],
    },
  };
}

function writeFixture() {
  const content = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'clients', 'example-contractor', 'content.json'), 'utf8'));
  content.site.name = 'Legal content E2E';
  content.site.baseUrl = 'https://legal-content-e2e.example.test';
  content.site.nav.links = [
    { label: 'First', href: 'privacy-first.html' },
    { label: 'Later', href: 'privacy-later.html' },
  ];
  delete content.site.nav.cta;
  content.pages = [
    {
      slug: 'privacy-first',
      meta: { title: 'Privacy first', description: 'Legal content is the first block.' },
      blocks: [legalBlock('legal-first')],
    },
    {
      slug: 'privacy-later',
      meta: { title: 'Privacy later', description: 'Legal content follows another block.' },
      blocks: [
        { id: 'intro', type: 'text', fields: { body: ['Introductory copy.'] } },
        legalBlock('legal-later'),
      ],
    },
  ];
  fs.rmSync(clientDir, { recursive: true, force: true });
  fs.mkdirSync(clientDir, { recursive: true });
  fs.writeFileSync(path.join(clientDir, 'content.json'), JSON.stringify(content, null, 2) + '\n', 'utf8');
}

function build() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'build.js'), CLIENT],
    { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`fixture build failed:\n${result.stdout}${result.stderr}`);
}

function startStaticServer() {
  const root = path.resolve(distDir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.normalize(path.join(root, urlPath === '/' ? 'privacy-first.html' : urlPath));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(done => server.close(done)),
  })));
}

async function geometry(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.nav').getBoundingClientRect();
    const section = document.querySelector('.legal-content-section');
    const heading = section.querySelector('h1').getBoundingClientRect();
    return {
      navBottom: nav.bottom,
      headingTop: heading.top,
      gap: heading.top - nav.bottom,
      inlinePadding: section.style.paddingTop,
      computedPadding: getComputedStyle(section).paddingTop,
    };
  });
}

async function main() {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  let browser;
  let server;
  try {
    writeFixture();
    build();
    server = await startStaticServer();
    browser = await chromium.launch();
    const page = await browser.newPage();

    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${server.url}/privacy-first.html`, { waitUntil: 'load' });
      const first = await geometry(page);
      const label = `${viewport.width}px`;
      check(first.headingTop >= first.navBottom,
        `${label}: heading top ${first.headingTop} overlaps nav bottom ${first.navBottom}`);
      check(first.gap >= 54,
        `${label}: legal heading clears the nav by only ${first.gap}px (expected the 3.4rem section gap)`);
      check(first.inlinePadding === 'calc(73px + 3.4rem)',
        `${label}: first legal block lacks the scoped nav-clearance style (${first.inlinePadding})`);

      await page.goto(`${server.url}/privacy-later.html`, { waitUntil: 'load' });
      const later = await geometry(page);
      check(later.inlinePadding === '',
        `${label}: a later legal block received first-block nav clearance`);
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    fs.rmSync(clientDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  console.log('\n═══ LEGAL CONTENT E2E — a standalone policy clears the fixed navigation ═══');
  if (!failures.length) {
    console.log('PASS — with legal-content as the first rendered block, its h1 clears the');
    console.log('       fixed 73px navigation by the full 3.4rem section gap at 390px and');
    console.log('       desktop widths; a later legal block receives no special clearance.');
  } else {
    console.log(`FAIL — ${failures.length} issue(s):`);
    failures.forEach(failure => console.log(`       ✕ ${failure}`));
    process.exitCode = 1;
  }
}

main().catch(error => { console.error(error); process.exit(1); });
