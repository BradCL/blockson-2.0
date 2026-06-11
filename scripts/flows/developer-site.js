/**
 * Flow spec: the developer tutorial's site captures — every page of the
 * built wren-and-willow demo at both viewports, a scroll-through of the
 * homepage, and one teaser of the owner editor (serve.js) for the
 * "what the owner sees next" stub.
 *
 *   node engine/build.js wren-and-willow      # build first
 *   node scripts/capture-tutorial.js scripts/flows/developer-site.js
 */
'use strict';

const { spawn } = require('child_process');

const PAGES = [
  ['home', 'index.html', 'Homepage: hero, services, stats, before/after, testimonials, booking CTA'],
  ['services', 'services.html', 'Services & pricing: two pricing tables, process steps, FAQ'],
  ['about', 'about.html', 'About: story, promises, team grid, hours table'],
  ['gallery', 'gallery.html', 'Gallery: filterable albums with lightbox'],
  ['contact', 'contact.html', 'Contact (instantiated from the contact-page blueprint)'],
];

let editor = null;

module.exports = {
  name: 'developer-site',
  outDir: 'docs/tutorial/developer/img',
  serve: { root: 'dist/wren-and-willow' },

  // The owner-editor teaser needs the real serve.js running. Port 4180
  // avoids colliding with a dev's own editor on the default 4173.
  setup: () => new Promise((resolve, reject) => {
    editor = spawn('node', ['engine/serve.js', 'wren-and-willow', '--port', '4180'],
      { cwd: require('path').resolve(__dirname, '..', '..') });
    let buf = '';
    const timer = setTimeout(() => reject(new Error('serve.js never printed its banner:\n' + buf)), 30000);
    const onData = d => {
      buf += d.toString();
      if (buf.includes('http://127.0.0.1:4180')) { clearTimeout(timer); resolve(); }
    };
    editor.stdout.on('data', onData);
    editor.stderr.on('data', onData);
    editor.on('error', reject);
  }),

  teardown: async () => { if (editor) editor.kill(); },

  steps: [
    ...PAGES.map(([slug, file, description]) => ({
      slug,
      description,
      capture: 'fullpage',
      action: async ({ page, baseUrl }) => { await page.goto(`${baseUrl}/${file}`); },
    })),

    {
      slug: 'home-scroll',
      description: 'Scroll-through of the homepage (animation; frames if no GIF ffmpeg)',
      viewports: ['desktop'],
      capture: 'animation',
      fps: 1,
      action: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/index.html`);
        await page.waitForLoadState('networkidle');
      },
      animate: async ({ page, frame }) => {
        const total = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
        const stops = 8;
        for (let i = 0; i <= stops; i++) {
          await page.evaluate(y => window.scrollTo({ top: y }), Math.round(total * i / stops));
          await page.waitForTimeout(700); // let the .fade-in reveals finish
          await frame();
        }
      },
    },

    {
      slug: 'gallery-lightbox',
      description: 'Gallery album opened in the lightbox',
      viewports: ['desktop'],
      capture: 'viewport',
      action: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/gallery.html`);
        await page.waitForLoadState('networkidle');
        await page.click('.album-card');
        await page.waitForTimeout(400);
      },
    },

    {
      slug: 'owner-editor',
      description: 'TEASER for the owner tutorial: serve.js click-to-edit editor (candidate preview + session panel)',
      viewports: ['desktop'],
      capture: 'viewport',
      settle: false,
      action: async ({ page }) => {
        await page.goto('http://127.0.0.1:4180/');
        // The editor builds the candidate annotated on first load — give
        // the iframe preview time to appear.
        await page.waitForTimeout(4000);
      },
    },
  ],
};
