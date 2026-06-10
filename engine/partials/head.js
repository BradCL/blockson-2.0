'use strict';

const { esc } = require('../lib/escape');

// Fallback font URLs when no tokens.json is present (backwards compatibility).
const THEME_FONTS = {
  default: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=DM+Sans:ital,wght@0,400;0,500;1,400&display=swap',
  clean:   'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Open+Sans:ital,wght@0,400;0,500;1,400&display=swap',
  warm:    'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&family=Nunito+Sans:ital,wght@0,400;0,500;1,400&display=swap',
};

module.exports = function head(page, site, tokens) {
  const title       = esc(page.meta.title);
  const description = esc(page.meta.description);
  const canonical   = `${site.baseUrl}/${page.slug === 'index' ? '' : page.slug + '.html'}`;
  const ogImage     = page.meta.ogImage
    ? `${site.baseUrl}/${page.meta.ogImage}`
    : (site.logo && site.logo.black ? `${site.baseUrl}/${site.logo.black}` : '');
  const favicon     = site.logo.favicon;
  const fontUrl     = (tokens && tokens.googleFontsUrl)
    || THEME_FONTS[site.theme || 'default']
    || THEME_FONTS.default;

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

  <!-- Google Fonts (preconnect avoids render-blocking @import in CSS) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${fontUrl}">

  <!-- Theme stylesheet -->
  <link rel="stylesheet" href="css/styles.css">
${rootBlock}</head>`;
};

function buildRootBlock(tokens) {
  const entries = Object.entries(tokens)
    .filter(([k]) => k !== 'googleFontsUrl' && k !== 'cssBase')
    .map(([k, v]) => `    --${k}: ${v};`)
    .join('\n');
  return `  <style>\n    :root {\n${entries}\n    }\n  </style>\n`;
}
