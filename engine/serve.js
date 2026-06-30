#!/usr/bin/env node
/* ============================================================
   engine/serve.js — Local owner-editor server (v4, Task 2)

     node engine/serve.js <client> [--port N] [--host ADDR] [--allow-remote]

   Serves the click-to-edit owner UI for one client on localhost.
   The browser page (engine/ui/) shows the candidate preview in an
   iframe next to the session panel; the preview is the client's
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
     GET  /api/state             session state: staged list, pending card, tokens, pages
     GET  /api/field?...         describe one editable field (current value, editor kind)
     GET  /api/section?block=    describe one section's settings + addable fields (Section panel)
     GET  /api/blueprints        the validated blueprint registry (Add… menu)
     POST /api/edit              { patch, upload? }  → pending change
     POST /api/scaffold          { blueprint, variant, values, uploads?,
                                   targetPage? | targetBlock? } → pending change
     POST /api/remove-item       { block, item } → pending change (item removal)
     POST /api/token-check       { token, value }    → live guard run, no write
     POST /api/keep              pending change → the session's staged list
     POST /api/discard           drop the pending change (staged list survives)
     POST /api/publish           the whole staged session → live, one publish
     POST /api/discard-all | /api/restore

   SECURITY
   - Binds 127.0.0.1 unless configured otherwise; additionally rejects
     any request whose socket is not loopback, and any request whose
     Host header is not local — unless allowRemote is set explicitly.
   - Access token (owner-config.json "accessToken"): when allowRemote
     is true a non-empty token is REQUIRED — the server refuses to
     start without one, because the token is what replaces the
     locality guard. The owner opens http://host:port/?token=…; the
     server verifies it (crypto.timingSafeEqual over equal-length
     sha256 digests) and answers with an HttpOnly session cookie;
     every subsequent request — static and API alike — must carry
     that cookie (or present the token again). On plain loopback the
     token is optional, but enforced identically when set. A refused
     request gets a plain-language page, never a stack trace.
   - Every POST must carry the custom header "x-blockson-ui: 1" — the
     session cookie is in ADDITION to this header, never instead of it.
     Cross-origin pages cannot set custom headers without a CORS
     preflight, and this server never answers preflights or sends CORS
     headers — so a malicious web page cannot drive the editor.
   - Static file paths are resolved and confined to their root
     directory (no traversal), request bodies are size-capped, and the
     UI renders every value via textContent (no HTML injection).
   - Every response carries X-Content-Type-Options: nosniff (an uploaded
     file can never be sniffed into HTML) and X-Frame-Options: SAMEORIGIN
     (no non-local page can frame the editor or the preview).
   These request guards are exercised over real HTTP by proof 13.
   ============================================================ */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const owner = require('./lib/owner');

const UI_DIR = path.join(__dirname, 'ui');
const UI_FILES = new Set(['ui.js', 'help.js', 'ui.css', 'overlay.js']);
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
  // Remote-open without a token is refused outright, BEFORE the candidate
  // build: allow-remote disables the locality guard, so the access token
  // must take its place — an open LAN port must never mean an open editor.
  const preview = { ...owner.loadConfig(clientName), ...overrides };
  if (preview.allowRemote && !(typeof preview.accessToken === 'string' && preview.accessToken.trim() !== '')) {
    console.error('Refusing to start: allow-remote is set but no access token is configured.');
    console.error('Remote editing needs one — without it, anyone who can reach this port can publish the site.');
    console.error(`Add  "accessToken": "<a long random string>"  to clients/${clientName}/owner-config.json,`);
    console.error('then start again and give the owner the link this server prints.');
    process.exit(1);
  }
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

// ── Access token (Task 2) ──────────────────────────────────────
// When owner-config.json sets accessToken, every request must present
// it once (?token=…) and ride an HttpOnly session cookie thereafter.
// The session secret is fresh per server start, so a stolen cookie
// dies with the process; the token itself never goes into a cookie.
const ACCESS_TOKEN = (typeof cfg.accessToken === 'string' && cfg.accessToken.trim() !== '')
  ? cfg.accessToken : null;
const SESSION_COOKIE = 'blockson-session';
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// timingSafeEqual demands equal-length buffers; hashing both sides
// first guarantees that without an early length-based return.
function safeEqual(a, b) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest());
}

function sessionCookieValue(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

// True if the request may proceed; presenting the token in the URL
// issues the session cookie on this response as a side effect.
function authorized(req, res, url) {
  if (!ACCESS_TOKEN) return true;
  const cookie = sessionCookieValue(req);
  if (cookie !== null && safeEqual(cookie, SESSION_SECRET)) return true;
  const token = url.searchParams.get('token');
  if (token !== null && safeEqual(token, ACCESS_TOKEN)) {
    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${SESSION_SECRET}; HttpOnly; SameSite=Strict; Path=/`);
    return true;
  }
  return false;
}

function sendAccessPage(res) {
  res.writeHead(403, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end([
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<title>Access link needed</title></head>',
    '<body style="font-family: system-ui, sans-serif; max-width: 36em; margin: 4em auto; line-height: 1.5">',
    '<h1>This editor needs its access link</h1>',
    '<p>Open the exact link your developer gave you — it ends in <code>?token=…</code>.',
    ' After that first visit, this browser stays signed in until the editor is restarted.</p>',
    '<p>If you don’t have the link, ask your developer to send it again.</p>',
    '</body></html>',
  ].join('\n'));
}

// Defense-in-depth headers on every response: nothing this server sends
// may be MIME-sniffed into another type, and nothing may be framed by a
// non-local page (SAMEORIGIN still lets the editor frame its own preview).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
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
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS };
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
  if (!authorized(req, res, url)) return sendAccessPage(res);
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
    if (pathname === '/api/blueprints') {
      return sendJson(res, 200, owner.listBlueprints());
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
    if (pathname === '/api/section') {
      const r = owner.describeSection(session, { block: url.searchParams.get('block') || undefined });
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
    else if (pathname === '/api/scaffold')    r = owner.applyScaffold(session, body);
    else if (pathname === '/api/remove-item') r = owner.applyRemoveItem(session, body);
    else if (pathname === '/api/token-check') r = owner.checkToken(session, body.token, body.value);
    else if (pathname === '/api/keep')        r = owner.keep(session);
    else if (pathname === '/api/publish')     r = owner.publish(session);
    else if (pathname === '/api/discard')     r = owner.discard(session);
    else if (pathname === '/api/discard-all') r = owner.discardAll(session);
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
  // server.address().port, not cfg.port: with --port 0 the OS assigns an
  // ephemeral port (proof 13 starts the real server that way).
  const port = server.address().port;
  console.log(`Owner editor for "${session.config.clientName || session.client}"`);
  console.log(`  → http://${cfg.host}:${port}/${ACCESS_TOKEN ? '?token=' + encodeURIComponent(ACCESS_TOKEN) : ''}`);
  console.log(`  publish: ${cfg.publish === 'none' ? 'off' : cfg.publish === 'git' || cfg.publish == null ? 'git add/commit/push' : 'custom command'}`);
  if (ACCESS_TOKEN) console.log('  access token set: the editor opens only through the link above (then a session cookie).');
  if (cfg.allowRemote) console.log('  ⚠ --allow-remote is set: non-local requests are accepted.');
});
