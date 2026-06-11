# Atlas 13 — The security mindset

## In class you learned…

"Validate user input." Maybe SQL injection and XSS got a lecture each.
Security looked like a checklist of named attacks to remember.

## In Blockson it lives at…

Everywhere — and that's the lesson. This chapter walks **one mindset**
through six unrelated surfaces. The mindset, in two sentences:

> **Never trust input — not from the owner, not from the browser, not
> from your own UI.** And when in doubt, refuse: *a rejected action is a
> UX cost; a wrong write that lands is a safety failure.*

Watch the same move repeat:

### 1. The link-scheme guard — `engine/lib/validate.js` and the schema

```js
const SAFE_HREF_RE = /^(?:(?:https?:\/\/|mailto:|tel:|sms:|#).*|[^:]*)$/;
```

Why guard an `href`? Because `<a href="javascript:alert(1)">` executes
code when clicked — a link is an injection point. The rule is an
**allowlist**: these schemes are safe, *everything else* is refused —
including schemes nobody has invented yet. (A blocklist of known-bad
schemes would silently admit the next one.) The same rule exists as
`$defs/safeHref` in `content.schema.json`, and stricter keys
(`HTTPS_ONLY_KEYS`: `formAction`, `mapEmbedUrl`, `videoUrl`) must be
`https://` because they become form targets and iframe sources. Proof 11
checks a blueprint can't smuggle a `javascript:` link past the build.

### 2. Output escaping — `engine/lib/escape.js`

```js
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
```

Five characters stand between content and markup. Every block renderer
wraps every interpolated value in `esc(...)` — and the editor UI's
counterpart is `textContent`-only rendering
([atlas 07](07-dom-and-events.md)). Input validation and output escaping
are *different defenses*: validation rejects bad data at the door;
escaping makes even accepted data inert where it's used.

### 3. Upload byte-validation — `engine/lib/owner.js`

`prepareUpload` ([atlas 09](09-images.md)) trusts nothing the browser
said: extension allowlist, 8 MB cap, filename sanitization, and
`IMAGE_SIGNATURES` — the bytes must *be* the format the name claims.
The browser's own checks (`accept=`, client-side compression) exist too,
but as courtesy. **Client-side is UX; server-side is security.**

### 4. Path confinement — `engine/serve.js`

```js
const resolved = path.normalize(path.join(root, relPath));
if (resolved !== root && !resolved.startsWith(root + path.sep)) {
  return sendError(res, 403, 'forbidden path');
}
```

A URL like `/preview/..%2f..%2f.git/config` decodes to a path that
escapes the preview directory. `sendStatic` resolves the requested path
*first*, then checks the result still lives under its root. Resolve, then
compare — never pattern-match on the raw string, which encoding tricks
defeat. (Proof 13 fires encoded traversal probes at the real server.)
Note the same instinct in `prepareUpload`'s `path.basename(upload.name)`
and `createSession`'s client-name regex: anything that becomes a path
gets confined.

### 5. Locality, tokens, and the header guard — `engine/serve.js`

Layered, not single:

- **Bind loopback** (`127.0.0.1`) — other machines can't even connect.
- **Check the socket anyway** (`requestAllowed`: `LOOPBACK.has(req.socket.remoteAddress)`)
  — in case the bind config changes.
- **Check the `Host` header too** — a malicious website can make your own
  browser request `http://localhost:4173/` (DNS rebinding tricks); a
  foreign `Host` gives it away.
- **Require `x-blockson-ui: 1` on every POST** — a cross-origin page
  can't set a custom header without a CORS preflight, and this server
  never grants one. So no web page can drive the editor from inside your
  browser.
- **`--allow-remote` refuses to start without an access token**, verified
  with `crypto.timingSafeEqual` over equal-length sha256 digests
  (`safeEqual`) — a deliberately constant-time comparison, because even
  *response timing* can leak how many characters of a guess were right.

Any one layer failing leaves four standing. That's **defense in depth**
as architecture, not slogan.

### 6. The write allowlist and the CSS guards — `engine/lib/patch.js`

The resolver ([system map](../01-system-map.md)) is input validation
elevated to architecture: `FORBIDDEN_KEYS`, the container guard, type
preservation, and for theme tokens a per-type **format allowlist**
(`validateTokenValue`) *plus* an injection blacklist:

```js
const DANGEROUS_VALUE = /[;{}<>\\@]|url\s*\(|\/\*|expression|javascript:/i;
```

A token value lands inside a `:root { --name: value; }` block; a `;` or
`}` in it could escape the declaration and write arbitrary CSS. Both
guards run — the allowlist says what's acceptable, the blacklist
documents what the author was determined to stop even if the allowlist
regresses. And the **contrast guard** (`contrastRatio`, `TOKEN_PAIRS`)
extends "harm" past code execution: white-on-white text is also an attack
on the site's usefulness, just an accidental one.

> **Term: allowlist vs. blocklist.** An allowlist permits only what's
> enumerated (safe by default); a blocklist forbids only what's
> enumerated (unsafe by default — unknown things pass). Every guard in
> this codebase that matters is an allowlist; blacklists appear only as a
> second layer behind one.

## What production adds

The classroom frames security as defending against *attackers*. Most of
these guards defend against something subtler: **honest people, confused
software, and future code.** The owner pasting a weird URL isn't
malicious; the browser sending a stale request isn't malicious; the new
feature that forgets a check isn't malicious. Guards that only fire on
malice are tested never; guards on every path are tested constantly.
Hence the recurring shape: *one chokepoint, allowlist semantics, refusal
with a plain-language reason, and a numbered proof.*

## Why here, why this way

This system hands write access to a non-technical user and then runs
unattended for years — the threat model is "everything, eventually, with
nobody watching." The defenses are cheap individually (a regex, a header
check, eight magic bytes); what's expensive is the *discipline* of asking,
at every input: who could put what here, and what's the worst that value
could do where it lands? Carry that question into every codebase you
touch. It is the entire chapter.

---

## Try it

**Exercise 1 (predict, then verify).** *Question:* can a theme-token
value smuggle CSS out of its declaration? The value lands inside
`:root { --color-primary: VALUE; }` - so what does the guard do with a
value like `red;}body{display:none`? **Predict which guard fires
(format allowlist, injection blacklist, or contrast), then run:**

```
node engine/apply-patch.js learning-lab '{"action":"set-token","token":"--color-primary","value":"red;}body{display:none"}'
```

<details><summary>What you should see</summary>

`Error: value failed the safety guard (unsafe characters or too long)` -
that's `DANGEROUS_VALUE` (the `;` and `{` and `}`) firing inside
`validateTokenValue`, before the color-format check even matters.
Nothing written.</details>

**Exercise 2 (predict, then verify).** *Question:* what stops
white-on-white? The default theme's `--color-bg` is `#0f1115`. **Predict
what happens if you set `--color-primary` to exactly that, then run:**

```
node engine/apply-patch.js learning-lab '{"action":"set-token","token":"--color-primary","value":"#0f1115"}'
```

<details><summary>What you should see</summary>

`Error: "#0f1115" is too close to the theme's --color-bg (#0f1115) - the
result would be unreadable. Pick a color with more contrast.` The
contrast guard (`contrastRatio` against `TOKEN_PAIRS`) - rejecting a
perfectly *valid* color because of where it would land. Validity is
contextual.</details>

**Exercise 3 (predict, then verify).** With
`node engine/serve.js learning-lab` running, probe path confinement:

```
curl -i --path-as-is "http://127.0.0.1:4173/preview/..%2f..%2f..%2fpackage.json"
```

Predict the status code first.

<details><summary>What you should see</summary>

`403` with `forbidden path` (or `404` - either way, no file contents).
`sendStatic` resolved the decoded path and found it outside the preview
root. Proof 13 runs this same probe in CI.</details>

## Self-check

1. Which file validates uploads, which validates link schemes, and which
   confines static paths?
   <details><summary>Answer</summary>`engine/lib/owner.js`
   (`prepareUpload` / `IMAGE_SIGNATURES`);
   `engine/lib/validate.js` + the schema (`SAFE_HREF_RE` /
   `$defs/safeHref`); `engine/serve.js` (`sendStatic`).</details>
2. Why is the href rule an allowlist rather than a blocklist of
   dangerous schemes?
   <details><summary>Answer</summary>A blocklist silently admits
   anything not yet on it (new or obscure schemes); an allowlist fails
   safe - the unknown is refused by default.</details>
3. Why does `safeEqual` hash both values before
   `crypto.timingSafeEqual`?
   <details><summary>Answer</summary>`timingSafeEqual` requires
   equal-length buffers; hashing both sides to fixed-length digests
   guarantees that without an early length-based return - which would
   itself leak information through timing.</details>
4. Transfer: where would you ADD a new guard if blocks gained a
   `customCss` field (free-form CSS per block), and what proof would you
   write?
   <details><summary>Answer</summary>Trick question the codebase
   answers: such a field shouldn't exist - it's unguardable free-form
   code from the maintenance tier. The Blockson-shaped alternative is
   more SAFE_TOKENS-style allowlisted values. If forced, the guard
   belongs in `validateTokenValue`-like per-type checks in `patch.js`
   plus the schema, and the proof: a value containing `}`, `url(`, or
   `expression` never reaches a built page.</details>
