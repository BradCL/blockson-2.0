#!/usr/bin/env node
/* ============================================================
   engine/serve.js — Local owner-editor server (v4, Task 2)

     node engine/serve.js <client> [--port N] [--host ADDR] [--allow-remote]

   Serves the click-to-edit owner UI for one client on localhost.
   The browser page (engine/ui/) shows the candidate preview in an
   iframe next to a pending-change panel; the preview is the client's
   ANNOTATED candidate build (dist/<client>__candidate__annotated/),
   into which this server injects the overlay script AT SERVE TIME —
   nothing on disk ever contains the overlay, and live builds are
   never served here at all.

   All editing logic lives in engine/lib/owner.js (the request
   handlers, exercised directly by proof 8); this file is only the
   HTTP plumbing:

     GET  /                      editor app
     GET  /ui/<asset>            app assets (allowlisted filenames)
     GET  /preview/...           annotated candidate build (+ overlay in HTML)
     GET  /api/state             session state: pending card, tokens, pages
     GET  /api/field?...         describe one editable field (current value, editor kind)
     POST /api/edit              { patch, upload? }  → pending change
     POST /api/token-check       { token, value }    → live guard run, no write
     POST /api/approve | /api/discard | /api/restore

   SECURITY
   - Binds 127.0.0.1 unless configured otherwise; additionally rejects
     any request whose socket is not loopback, and any request whose
     Host header is not local — unless allowRemote is set explicitly.
   - Every POST must carry the custom header "x-blockson-ui: 1".
     Cross-origin pages cannot set custom headers without a CORS
     preflight, and this server never answers preflights or sends CORS
     headers — so a malicious web page cannot drive the editor.
   - Static file paths are resolved and confined to their root
     directory (no traversal), request bodies are size-capped, and the
     UI renders every value via textContent (no HTML injection).
   ============================================================ */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const owner = require('./lib/owner');

const UI_DIR = path.join(__dirname, 'ui');
const UI_FILES = new Set(['ui.js', 'ui.css', 'overlay.js']);
const MAX_BODY_BYTES = 12 * 1024 * 1024; // image uploads travel base64-encoded in JSON

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg':  'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ── CLI ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const clientName = args.find(a => !a.startsWith('--'));
if (!clientName) {
  console.error('Usage: node engine/serve.js <client> [--port N] [--host ADDR] [--allow-remote]');
  process.exit(1);
}
function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

let session;
try {
  const overrides = {};
  if (flagValue('--port')) overrides.port = Number(flagValue('--port'));
  if (flagValue('--host')) overrides.host = flagValue('--host');
  if (args.includes('--allow-remote')) overrides.allowRemote = true;
  session = owner.createSession(clientName, overrides);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
const cfg = session.config;

// ── Request guards ─────────────────────────────────────────────
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', String(cfg.host)]);

function requestAllowed(req) {
  if (cfg.allowRemote) return true;
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  const hostHeader = String(req.headers.host || '');
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return LOCAL_HOSTNAMES.has(hostname);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

// Serve one file from under `root`, refusing anything that resolves
// outside it. `relPath` is the already-decoded URL remainder.
function sendStatic(res, root, relPath, injectOverlay) {
  const resolved = path.normalize(path.join(root, relPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return sendError(res, 403, 'forbidden path');
  }
  let target = resolved;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return sendError(res, 404, 'not found');
  }
  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (injectOverlay && ext === '.html') {
    // The overlay is injected at serve time, only into pages of the
    // annotated candidate build — never written to disk, never live.
    const html = fs.readFileSync(target, 'utf8')
      .replace(/<\/body>(?![\s\S]*<\/body>)/, '<script src="/ui/overlay.js"></script></body>');
    res.writeHead(200, headers);
    return res.end(html);
  }
  res.writeHead(200, headers);
  fs.createReadStream(target).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── Router ─────────────────────────────────────────────────────
async function handle(req, res) {
  if (!requestAllowed(req)) return sendError(res, 403, 'This editor only accepts local requests.');

  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return sendError(res, 400, 'bad url'); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (e) { return sendError(res, 400, 'bad path'); }

  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      return sendStatic(res, UI_DIR, 'index.html', false);
    }
    if (pathname.startsWith('/ui/')) {
      const name = pathname.slice(4);
      if (!UI_FILES.has(name)) return sendError(res, 404, 'not found');
      return sendStatic(res, UI_DIR, name, false);
    }
    if (pathname === '/preview' || pathname === '/preview/') {
      return sendStatic(res, owner.candDistDir(session), 'index.html', true);
    }
    if (pathname.startsWith('/preview/')) {
      return sendStatic(res, owner.candDistDir(session), pathname.slice('/preview/'.length), true);
    }
    if (pathname === '/api/state') {
      return sendJson(res, 200, owner.getState(session));
    }
    if (pathname === '/api/field') {
      const q = url.searchParams;
      const ref = {
        block: q.get('block') || undefined,
        item:  q.get('item')  || undefined,
        field: q.get('field') || undefined,
        index: q.get('index'),
      };
      const r = owner.describeField(session, ref);
      return sendJson(res, r.ok ? 200 : 400, r);
    }
    return sendError(res, 404, 'not found');
  }

  if (req.method === 'POST') {
    if (req.headers['x-blockson-ui'] !== '1') {
      return sendError(res, 403, 'missing editor header');
    }
    let body = {};
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      return sendError(res, 400, e.message === 'request too large' ? e.message : 'request body is not valid JSON');
    }

    let r;
    if      (pathname === '/api/edit')        r = owner.applyEdit(session, body.patch, body.upload || null);
    else if (pathname === '/api/token-check') r = owner.checkToken(session, body.token, body.value);
    else if (pathname === '/api/approve')     r = owner.approve(session);
    else if (pathname === '/api/discard')     r = owner.discard(session);
    else if (pathname === '/api/restore')     r = owner.restore(session);
    else return sendError(res, 404, 'not found');
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  return sendError(res, 405, 'method not allowed');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error(e);
    try { sendError(res, 500, 'internal error'); } catch (_) { /* response already gone */ }
  });
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`Owner editor for "${session.config.clientName || session.client}"`);
  console.log(`  → http://${cfg.host}:${cfg.port}/`);
  console.log(`  publish: ${cfg.publish === 'none' ? 'off' : cfg.publish === 'git' || cfg.publish == null ? 'git add/commit/push' : 'custom command'}`);
  if (cfg.allowRemote) console.log('  ⚠ --allow-remote is set: non-local requests are accepted.');
});
