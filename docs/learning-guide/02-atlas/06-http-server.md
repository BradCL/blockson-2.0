# Atlas 06 — The HTTP server

## In class you learned…

That a web server listens on a port, receives requests (method, URL,
headers, body), and sends responses (status code, headers, body). You
probably built one with Express: `app.get('/route', handler)`.

## In Blockson it lives at…

`engine/serve.js` — the owner editor's server, built on Node's built-in
`http` module with **no framework at all**. Its header comment is the
table of contents: a handful of `GET` routes (the editor app, its assets,
the preview, the state API) and the `POST /api/*` routes that drive
editing. The actual editing logic lives in `engine/lib/owner.js`;
`serve.js` is, in its own words, "only the HTTP plumbing."

## A guided read-through

The whole server is one function, `handle(req, res)`, called per request:

```js
async function handle(req, res) {
  if (!requestAllowed(req)) return sendError(res, 403, 'This editor only accepts local requests.');

  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return sendError(res, 400, 'bad url'); }
  if (!authorized(req, res, url)) return sendAccessPage(res);
  ...
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      return sendStatic(res, UI_DIR, 'index.html', false);
    }
    ...
  }
  if (req.method === 'POST') {
    if (req.headers['x-blockson-ui'] !== '1') {
      return sendError(res, 403, 'missing editor header');
    }
    ...
    if      (pathname === '/api/edit')        r = owner.applyEdit(session, body.patch, body.upload || null);
    else if (pathname === '/api/scaffold')    r = owner.applyScaffold(session, body);
    ...
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  return sendError(res, 405, 'method not allowed');
}
```

Things to read off this skeleton:

- **Routing is just `if` on `pathname`.** Express's `app.get('/x', fn)` is
  sugar over exactly this. With ~14 routes, the sugar isn't needed.
- **Guards run before routes.** Locality (`requestAllowed`), then auth
  (`authorized`), then — for POSTs — the custom-header check. A request
  that fails a guard never reaches any handler. Order is a security
  decision, not style.
- **The handler functions return `{ ok, ... }` objects** and the server
  maps that onto HTTP (`r.ok ? 200 : 400`). The line between "HTTP layer"
  and "application layer" is sharp enough that the proof suite tests
  `owner.js` *with no server at all* (proof 8) and the server's guards
  *over real HTTP* (proof 13).

Request bodies need assembling — HTTP delivers them in chunks. `readBody`
shows the standard pattern plus a production guard:

```js
req.on('data', c => {
  size += c.length;
  if (size > MAX_BODY_BYTES) { reject(new Error('request too large')); req.destroy(); return; }
  chunks.push(c);
});
req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
```

Without the size check, any client could send an endless body and fill
memory. `MAX_BODY_BYTES` is 12 MB because image uploads travel
base64-encoded inside JSON — the limit is derived from a real need, not
picked at random.

> **Term: loopback / 127.0.0.1.** The network address that always means
> "this same machine." A server bound to it is unreachable from any other
> computer. `serve.js` binds loopback by default *and* rejects requests
> whose socket isn't loopback — belt and suspenders (see
> [atlas 13](13-security-mindset.md)).

## What production adds

- **Headers as a defense layer.** Every response carries
  `SECURITY_HEADERS` (`X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`) and `Cache-Control: no-store`. Classroom
  servers send bodies; production servers also curate headers.
- **Correct MIME types from a table.** The `MIME` map at the top converts
  file extensions to `Content-Type`. Browsers behave differently when the
  type is wrong — and `nosniff` makes the declared type *binding*.
- **One catch at the top.** The server wraps `handle` so any unexpected
  exception logs server-side and sends a generic
  `sendError(res, 500, 'internal error')` — never a stack trace, which
  would leak file paths and internals to whoever's connected.
- **The ephemeral-port trick.** `server.listen(cfg.port, ...)` prints
  `server.address().port`, not `cfg.port`, because `--port 0` asks the OS
  for any free port — which is exactly how proof 13 starts a real server
  in tests without colliding with anything.

## Why here, why this way

Why no Express? Same answer as the CLI chapter: dependency cost. The
editor needs static files, a JSON API, and strict guards — about 340
lines with the stdlib. A framework would save fifty of them and add a
supply chain.

The deeper design choice is the **thin-plumbing rule**: `serve.js`
contains no editing logic, and `owner.js` contains no HTTP. That boundary
is what makes both halves testable in isolation — and it's the seam the
README points to for any future automation: anything that can call
`owner.applyEdit` gets exactly the same guards the UI gets, because the
guards don't live in the HTTP layer.

---

## Try it

*(Start the editor against the scratch client first:
`node engine/serve.js learning-lab` - leave it running in one terminal
and use another for the probes. `curl` ships with Windows 10+, macOS,
and Linux.)*

**Exercise 1 (predict, then verify).** *Question:* what happens to a
POST that doesn't carry the editor's custom header - 404, 400, or 403?
**Predict, then probe:**

```
curl -i -X POST http://127.0.0.1:4173/api/keep
```

<details><summary>What you should see</summary>

`HTTP/1.1 403 Forbidden` with body
`{"ok":false,"error":"missing editor header"}`. The route exists and the
request is local - but the `x-blockson-ui` check runs before any routing
of POSTs. Add `-H "x-blockson-ui: 1"` and repeat: now you get `400` with
`There is no pending change to keep.` - past the guard, into the
handler, refused by application logic instead.</details>

**Exercise 2 (predict, then verify).** *Question:* which response
headers does *every* answer carry? **Predict, then check** with
`curl -i http://127.0.0.1:4173/api/state` - look for the two
`X-…` security headers and the cache header, then find the
`SECURITY_HEADERS` constant in `engine/serve.js` that put them there.

## Self-check

1. Name the three guards a POST passes before reaching a handler, in
   order.
   <details><summary>Answer</summary>`requestAllowed` (loopback socket +
   local Host header), `authorized` (access token / session cookie, when
   configured), and the `x-blockson-ui: 1` header check.</details>
2. Why is there a 12 MB cap in `readBody`?
   <details><summary>Answer</summary>Without a cap, any client could
   stream an endless body and exhaust memory; 12 MB fits the largest
   legitimate payload - an 8 MB image, base64-encoded inside
   JSON.</details>
3. What does `serve.js` deliberately *not* contain, and why?
   <details><summary>Answer</summary>Editing logic - it routes to
   `owner.js` handlers and maps their `{ ok }` results onto status
   codes. The split lets proof 8 test the handlers without a socket and
   proof 13 test the HTTP guards over a real one.</details>
4. Transfer: you're adding `GET /api/ledger` to return the maintenance
   log. Where does the code go, and what could it return?
   <details><summary>Answer</summary>A route branch in `handle()` beside
   `/api/state`, calling a new reader function in `owner.js` (the logic
   layer) that parses `edits.log.jsonl` - and it inherits the locality,
   token, nosniff, and no-store behaviour for free because it flows
   through the same plumbing.</details>
