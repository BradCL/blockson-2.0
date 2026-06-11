/* Minimal harness smoke test: one full-page capture, both viewports. */
'use strict';

module.exports = {
  name: 'smoke',
  outDir: 'docs/tutorial/.smoke',
  serve: { root: 'dist/wren-and-willow' },
  steps: [
    {
      slug: 'home',
      description: 'Demo-client homepage, full page',
      capture: 'fullpage',
      action: async ({ page, baseUrl }) => { await page.goto(`${baseUrl}/index.html`); },
    },
  ],
};
