'use strict';

const { esc } = require('../lib/escape');

/* LOCAL-FIRST: built pages reference no external network resources —
   no CDN fonts, no remote scripts. Font tokens are self-contained
   stacks; a theme that wants a specific face ships it in its own css/
   via @font-face. (Remote Google Fonts links were removed in v4 to
   honor this invariant; tokens may no longer declare googleFontsUrl.) */

module.exports = function head(page, site, tokens) {
  const title       = esc(page.meta.title);
  const description = esc(page.meta.description);
  const canonical   = `${site.baseUrl}/${page.slug === 'index' ? '' : page.slug + '.html'}`;
  const ogImage     = page.meta.ogImage
    ? `${site.baseUrl}/${page.meta.ogImage}`
    : (site.logo && site.logo.black ? `${site.baseUrl}/${site.logo.black}` : '');
  const favicon     = site.logo.favicon;

  const rootBlock = tokens
    ? buildRootBlock(tokens)
    : '';

  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${esc(canonical)}">

  <!-- Open Graph -->
  <meta property="og:type"        content="website">
  <meta property="og:title"       content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url"         content="${esc(canonical)}">
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}

  <!-- Favicon -->
  <link rel="icon" href="${esc(favicon)}">

  <!-- Theme stylesheet -->
  <link rel="stylesheet" href="css/styles.css">
${rootBlock}</head>`;
};

function buildRootBlock(tokens) {
  // googleFontsUrl is filtered for backward compatibility with stale
  // third-party presets — it must not surface as a custom property.
  const entries = Object.entries(tokens)
    .filter(([k]) => k !== 'googleFontsUrl' && k !== 'cssBase')
    .map(([k, v]) => `    --${k}: ${v};`)
    .join('\n');
  return `  <style>\n    :root {\n${entries}\n    }\n  </style>\n`;
}
