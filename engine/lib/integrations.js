'use strict';

/* ============================================================
   engine/lib/integrations.js — opt-in client integration markup

   This is deliberately an allowlist, not a raw-markup escape hatch. A
   developer may configure the identifiers for the providers Blockson knows
   how to render and one in-repo client script; the engine owns every tag and
   therefore owns its document position, quoting, and fallback behavior.

   Nothing is emitted unless site.integrations exists. Annotated owner
   previews suppress all executable integration tags in lib/render.js so a
   preview cannot count a visit or run the client CRM bridge.
   ============================================================ */

const { esc } = require('./escape');

function configOf(site) {
  return site && site.integrations && typeof site.integrations === 'object'
    ? site.integrations : null;
}

function hasClientScript(site) {
  const cfg = configOf(site);
  return !!(cfg && cfg.clientScript);
}

function renderHeadTags(site) {
  const cfg = configOf(site);
  if (!cfg) return '';
  const tags = [];

  if (cfg.googleTagId) {
    const id = esc(cfg.googleTagId);
    const jsId = JSON.stringify(cfg.googleTagId);
    tags.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', ${jsId});
  </script>`);
  }

  if (cfg.metaPixelId) {
    const jsId = JSON.stringify(cfg.metaPixelId);
    tags.push(`<script>
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', ${jsId});
    fbq('track', 'PageView');
  </script>`);
  }

  return tags.length
    ? `\n\n  <!-- Developer-configured marketing -->\n  ${tags.join('\n  ')}`
    : '';
}

function renderBodyStartTags(site) {
  const cfg = configOf(site);
  if (!cfg || !cfg.metaPixelId) return '';
  const id = esc(cfg.metaPixelId);
  return `<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${id}&amp;ev=PageView&amp;noscript=1"></noscript>`;
}

function renderBodyEndTags(site) {
  const cfg = configOf(site);
  return cfg && cfg.clientScript
    ? `<script src="${esc(cfg.clientScript)}"></script>`
    : '';
}

module.exports = {
  configOf, hasClientScript, renderHeadTags, renderBodyStartTags, renderBodyEndTags,
};
