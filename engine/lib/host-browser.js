/* ============================================================
   engine/lib/host-browser.js — Browser host adapter for the owner editor

   The companion to engine/lib/host-node.js. The owner-editor session model
   (engine/lib/owner.js) keeps ALL the deterministic logic and delegates every
   side effect to an injected "host"; the Node host does it on disk, and THIS
   host does it entirely in memory so the SAME owner.js drives the no-install
   browser demo (a link a developer sends a prospect to try click-to-edit, with
   Publish disabled so nothing can go live). It is the Phase-2 fill for the seam
   Phase 1 extracted — not a second session implementation.

   The two differences from the Node host, both deliberate and both confined
   here (owner.js is untouched):

   1. Publishing is a HOST no-op. shipSession() reports nothing shipped
      (live:false), which is exactly what tells owner.publish() to leave the
      staged session intact; restore() is unsupported. The demo only ever
      REMOVES Publish — it never relaxes a guard. Every write still flows
      through applyPatch and the candidate build gate, identical to Node.

   2. The "build" renders the candidate IN MEMORY. The Node host shells out to
      engine/build.js and serve.js serves the resulting annotated build over
      /preview; here there is no disk and no server, so buildCandidate() runs
      the same validate() acceptance gate AND renders every page with the same
      renderPage + buildAnnotator, then makes each page a standalone document
      (theme CSS/JS inlined, every img/ reference rewritten to a Blob URL, the
      click-to-edit overlay injected) that the in-page transport loads into the
      preview iframe as a Blob URL (so the overlay's postMessage handshake has a
      real origin). The rendered pages and the image Blob URLs are stashed on the
      host for that transport to read (previewPage / assetUrl).

   Browser-only: createObjectURL / Blob are used at render time, so this module
   is required solely by the demo bundle and never by the Node path.
   ============================================================ */

'use strict';

const { renderPage }     = require('./render');
const { buildAnnotator } = require('./annotate');
const { validate }       = require('./validate');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
};
function mimeOf(name) {
  const ext = String(name).slice(String(name).lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// The site hero image (home-page hero background, else the first hero anywhere)
// — what a page-header that omits its own background inherits at render time,
// and the default og:image. Mirrors findSiteHeroImage in build.js (an entry
// script that can't be required) and siteHeroImage in owner.js.
function findSiteHeroImage(content) {
  const pages = (content && content.pages) || [];
  const heroBg = (page) => (page.blocks || [])
    .find(b => b && b.type === 'hero' && b.fields && b.fields.background);
  const index = pages.find(p => p.slug === 'index');
  const hit = (index && heroBg(index)) || pages.map(heroBg).find(Boolean);
  return hit ? hit.fields.background : null;
}

// Strip any literal </script> so an inlined script can't break out of its tag.
function safeInlineScript(src) {
  return String(src).replace(/<\/script/gi, '<\\/script');
}

/* Build a browser host for one seeded client.

   opts:
     content    — the seed content.json text (a string)
     images     — Map<name, Uint8Array> of the seed img/ files (flat names)
     clientName — display name for the editor chrome
     theme      — { tokens, css, js, overlay } inlined by the build script:
                    tokens  = the theme's tokens.json object (preset tokens)
                    css     = the theme's stylesheet text (one or more files joined)
                    js      = themes/default/js/main.js (+ theme overrides) text
                    overlay = engine/ui/overlay.js source text
*/
function createBrowserHost(opts) {
  const theme = opts.theme || {};
  const themeTokens = theme.tokens || null;
  const themeCss = theme.css || '';
  const themeJs = theme.js || '';
  const overlaySrc = theme.overlay || '';
  const config = { clientName: opts.clientName || 'Demo', publish: 'demo' };

  let liveText = opts.content;
  let candText = opts.content;
  let liveImages = new Map(opts.images || []);
  let candImages = new Map(opts.images || []);

  // Render output + Blob-URL bookkeeping, refreshed on every buildCandidate.
  let rendered = {};        // 'index.html' -> standalone HTML string
  let assetMap = {};        // 'img/foo.jpg' AND 'foo.jpg' -> blob: URL
  let liveBlobUrls = [];    // revoked and rebuilt each render (no leaks)

  function rebuildAssetMap() {
    for (const url of liveBlobUrls) { try { URL.revokeObjectURL(url); } catch (e) {} }
    liveBlobUrls = [];
    assetMap = {};
    for (const [name, bytes] of candImages) {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }));
      liveBlobUrls.push(url);
      assetMap[name] = url;
      assetMap['img/' + name] = url;
    }
  }

  // Rewrite every in-site image reference (img/… or ../img/… in inlined CSS) to
  // its Blob URL; references with no seeded/uploaded image are left as-is.
  function rewriteImages(html) {
    return html.replace(/(?:\.\.\/)?img\/([A-Za-z0-9._\-\/]+)/g, (m, rel) =>
      assetMap['img/' + rel] || m);
  }

  // Turn one rendered annotated page into a standalone preview document:
  // theme CSS + JS inlined (no server to serve css/ or js/), every image a Blob
  // URL, and the overlay injected exactly as serve.js injects it at serve time.
  function standalone(html) {
    let out = html.replace(
      /<link rel="stylesheet" href="css\/styles\.css">/,
      '<style>\n' + themeCss + '\n</style>');
    out = rewriteImages(out);   // covers the inlined CSS's url('../img/…') too
    out = out.replace(
      /<script src="js\/main\.js"><\/script>/,
      '<script>\n' + safeInlineScript(themeJs) + '\n</script>');
    out = out.replace(/<\/body>(?![\s\S]*<\/body>)/,
      '<script>\n' + safeInlineScript(overlaySrc) + '\n</script></body>');
    return out;
  }

  // The acceptance build, in memory: the SAME validate() gate engine/build.js
  // runs, then a full render of every page (the side effect that refreshes the
  // preview the transport serves). A failing gate leaves the last good preview
  // in place — owner.js rolls the candidate text back and calls us again.
  function buildText(text) {
    let content;
    try { content = JSON.parse(text); }
    catch (e) { return { ok: false, out: `content is not valid JSON: ${e.message}` }; }
    const r = validate(content);
    if (!r.ok) return { ok: false, out: (r.errors || []).join('\n') };

    // build.js derives this in memory after validation so page-headers inherit
    // the hero and og:image resolves; mirror it here.
    content.site.heroImage = findSiteHeroImage(content);
    const resolvedTokens = { ...(themeTokens || {}), ...((content.site && content.site.themeOverrides) || {}) };
    const annotator = buildAnnotator(content, resolvedTokens);

    const pages = {};
    try {
      for (const page of content.pages || []) {
        const file = page.slug === 'index' ? 'index.html' : `${page.slug}.html`;
        pages[file] = standalone(renderPage(page, content.site, resolvedTokens, annotator));
      }
    } catch (e) {
      return { ok: false, out: e.message };
    }
    return { ok: true, out: '', pages };
  }

  // buildCandidate / buildLive return only { ok, out } to owner.js (it inspects
  // nothing else); the rendered pages + Blob URLs are stashed for the transport.
  function buildCandidate() {
    rebuildAssetMap();
    const b = buildText(candText);
    if (b.ok) rendered = b.pages;
    return { ok: b.ok, out: b.out };
  }

  return {
    config,
    // Content store
    readCandidateText: () => candText,
    writeCandidateText: (t) => { candText = t; },
    readLiveText: () => liveText,
    writeLiveText: (t) => { liveText = t; },
    liveExists: () => true,
    resetCandidateFromLive: () => { candText = liveText; candImages = new Map(liveImages); },
    // Images (candidate-side; a real publish would copy them to live — here it
    // never does, so the live Map is only ever the seed)
    writeCandidateImage: (name, bytes) => { candImages.set(name, bytes); },
    removeCandidateImage: (name) => { candImages.delete(name); },
    candidateImageExists: (name) => candImages.has(name),
    // Builds
    buildCandidate,
    buildLive: () => { const b = buildText(liveText); return { ok: b.ok, out: b.out }; },
    // Derived data
    presetTokens: () => themeTokens,
    publishMode: () => 'demo',
    // Maintenance ledger: a demo keeps no record (ephemeral session)
    ledgerAppend: () => {},
    // Whole-session operations — Publish is disabled BY THE HOST. live:false is
    // the single signal that leaves the staged session intact in owner.publish().
    shipSession: () => ({ ok: true, live: false, skipped: true,
      message: 'This is a demo — your changes stay in this browser and are never published.' }),
    restore: () => ({ ok: false, error: 'Publishing is turned off in this demo, so there is nothing to restore.' }),

    // ── Browser-only extras the in-page transport reads (not part of the
    //    storage seam owner.js uses) ───────────────────────────────────────
    // The standalone HTML for a /preview/<path> request, which the transport
    // loads into the iframe as a Blob URL. Falls back to the home page for an
    // unknown path.
    previewPage: (reqPath) => {
      const rel = String(reqPath).replace(/^\/preview\/?/, '') || 'index.html';
      return rendered[rel] || rendered[rel + '.html'] || rendered['index.html'] || '';
    },
    // A usable URL for a /preview/img/… asset the editor chrome shows directly
    // (image thumbnails, the hero focal preview) — a Blob URL here.
    assetUrl: (p) => assetMap[String(p).replace(/^\/preview\//, '')] || '',

    // Path accessors exist on the Node host for serve.js; the demo has no
    // server, so they are harmless stubs (owner.js never calls them here).
    candDistDir: () => null,
    candContentPath: () => null,
    liveContentPath: () => null,
  };
}

module.exports = { createBrowserHost };
