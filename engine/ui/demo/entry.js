/* ============================================================
   engine/ui/demo/entry.js — Browser demo bootstrap (Phase 2)

   The in-page glue that turns the unchanged owner editor (engine/ui/ui.js)
   into a no-install browser demo. It runs BEFORE ui.js and:

     1. seeds the engine's two filesystem reads (schema, blueprint registry)
        through the Phase-1 setters, so validate() + scaffolding run with no fs;
     2. builds a BrowserHost over the inlined seed content + images and opens an
        owner session against it (the SAME owner.js, no fork);
     3. installs window.__blocksonTransport — the seam ui.js reads — routing the
        /api/* contract to the owner handlers in memory and feeding preview
        pages to the iframe via Blob URLs + image thumbnails via Blob URLs.

   Everything client-specific (content, images, theme, schema, blueprints) is
   inlined by engine/build-demo.js into ./seed.generated.js. This file is the
   stable bootstrap; the seed is the only thing that changes per client.

   Publishing is disabled by the host (BrowserHost.shipSession is a no-op), so
   the demo only ever REMOVES Publish — it relaxes no guard. Every edit still
   flows through applyPatch and the candidate build gate exactly as on Node.
   ============================================================ */
'use strict';

const owner    = require('../../lib/owner');
const validate = require('../../lib/validate');
const scaffold = require('../../lib/scaffold');
const { createBrowserHost } = require('../../lib/host-browser');
const seed = require('./seed.generated.js');

// Seed the two fs reads the engine would otherwise do (Phase-1 seam hooks).
validate.setSchema(seed.schema);
scaffold.setBlueprintRegistry(seed.blueprints);

// Seed images: base64 (bundle-friendly) -> Uint8Array, keyed by their path
// under img/ so they line up with the host's Blob-URL rewriting.
function b64ToBytes(b64) {
  const bin = atob(String(b64));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
const images = new Map();
for (const name of Object.keys(seed.images || {})) images.set(name, b64ToBytes(seed.images[name]));

const host = createBrowserHost({
  content: seed.content,
  images: images,
  clientName: seed.clientName,
  theme: seed.theme,
});
const session = owner.createSession(seed.clientName, null, host);

// ── The /api/* contract, answered in memory (mirrors engine/serve.js's
//    router, minus the HTTP/auth plumbing the demo has no use for) ──────────
function routeGet(reqPath) {
  const u = new URL(reqPath, 'http://demo.local');
  const q = u.searchParams;
  switch (u.pathname) {
    case '/api/state':      return owner.getState(session);
    case '/api/blueprints': return owner.listBlueprints();
    case '/api/field':      return owner.describeField(session, {
      block: q.get('block') || undefined, item: q.get('item') || undefined,
      field: q.get('field') || undefined, index: q.get('index'),
    });
    case '/api/section':    return owner.describeSection(session, { block: q.get('block') || undefined });
    default: return { ok: false, error: 'not found' };
  }
}
function routePost(reqPath, body) {
  body = body || {};
  switch (reqPath) {
    case '/api/edit':        return owner.applyEdit(session, body.patch, body.upload || null);
    case '/api/scaffold':    return owner.applyScaffold(session, body);
    case '/api/remove-item': return owner.applyRemoveItem(session, body);
    case '/api/token-check': return owner.checkToken(session, body.token, body.value);
    case '/api/keep':        return owner.keep(session);
    case '/api/publish':     return owner.publish(session);
    case '/api/discard':     return owner.discard(session);
    case '/api/discard-all': return owner.discardAll(session);
    case '/api/restore':     return owner.restore(session);
    default: return { ok: false, error: 'not found' };
  }
}

// The owner handlers are synchronous and return plain result objects; wrap them
// in resolved Promises so ui.js's apiGet/apiPost contract (a thenable JSON
// payload) is unchanged. A thrown handler (the ledger boundary rethrows) maps
// to the same shape a rejected request would have over HTTP.
// The preview document is loaded from a Blob URL rather than srcdoc: a srcdoc
// document's window.location.origin is the string "null", which makes the
// overlay's postMessage(..., window.location.origin) throw. A Blob URL carries
// the demo page's own origin, so the overlay ↔ editor postMessage handshake
// (which checks e.origin) works in both directions, and the page's image Blob
// URLs (same origin) still load. Revoked on the next load to avoid leaks.
let previewUrl = null;
window.__blocksonTransport = {
  apiGet: function (p) {
    try { return Promise.resolve(routeGet(p)); }
    catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
  },
  apiPost: function (p, body) {
    try { return Promise.resolve(routePost(p, body)); }
    catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
  },
  loadPreview: function (iframe, currentPath) {
    const html = host.previewPage(currentPath);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    iframe.src = previewUrl;
  },
  previewAsset: function (p) { return host.assetUrl(p); },
};
