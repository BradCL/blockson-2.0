# Atlas 09 — Image handling

## In class you learned…

`<img src="...">`, that images live in a folder next to your HTML, and
perhaps that big images make pages slow. Files were something you copied
by hand.

## In Blockson it lives at…

Images cross the whole system, and each station treats them differently:

| Station | File | What happens |
|---|---|---|
| Content | `content.json` | images are *string paths* like `"img/deck-3.jpg"` |
| Build | `engine/build.js` | `copyDir` copies `clients/<name>/img/` into `dist/`; `warnOnHeavyImages` complains about weight |
| Browser | `engine/ui/ui.js` | `compressImage` shrinks an upload before it's sent |
| Server | `engine/lib/owner.js` | `prepareUpload` validates name, size, and *bytes*, then assigns the final path |

## A guided read-through

Start at the browser. `compressImage` in `ui.js` turns a 4 MB phone photo
into a page-friendly few hundred KB *before upload*:

```js
return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
  var scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height)); // never upscale
  ...
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  ...
  var wantType = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
```

Decode → draw onto a canvas at reduced size → re-encode (`MAX_EDGE` 1920,
`QUALITY` 0.82). Three details repay study:

- `imageOrientation: 'from-image'` bakes the EXIF rotation into the
  pixels so portrait phone photos stay upright — and the re-encode then
  strips **all** metadata, *including GPS coordinates*. The comment calls
  this "a deliberate privacy property": owners upload phone photos of
  their own shop; those photos carry where they were taken.
- Every failure path resolves to the *original* file — "a failed
  compression must never block an upload the server would have accepted."
- The output filename's extension is chosen from the type the canvas
  *actually produced* (`EXT_BY_TYPE[blob.type]`), because the next station
  checks that names and bytes agree.

Now the server. `prepareUpload` in `owner.js` re-validates everything —
the extension allowlist (`IMAGE_EXTS`), the size cap (`MAX_IMAGE_BYTES`,
8 MB), and then the bytes themselves:

```js
const IMAGE_SIGNATURES = {
  '.png':  b => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 ...,
  '.jpg':  b => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  ...
};
...
if (!IMAGE_SIGNATURES[ext](bytes)) {
  return { error: `"...does not look like a real ${ext.slice(1).toUpperCase()} image..."` };
}
```

Every image format starts with characteristic **magic bytes** — PNG files
literally begin with the bytes for `\x89PNG`. Checking them means a file
named `photo.png` that actually contains HTML or a script is refused
regardless of what the browser claimed. The function also sanitizes the
filename (`path.basename(...).replace(/[^a-zA-Z0-9._-]+/g, '-')` — no
path separators survive) and resolves name collisions with a numeric
suffix rather than overwriting.

> **Term: magic bytes / file signature.** The fixed first bytes that
> identify a file format independent of its name. Names are claims;
> bytes are evidence.

## What production adds

- **The same validation twice, on purpose.** The browser compresses and
  the file input has an `accept` attribute — but the server re-checks
  everything, because anything can POST to an HTTP endpoint; the UI is
  just the polite client. Client-side checks are UX; server-side checks
  are security. Never confuse the two.
- **The server names the file, not the browser.** `applyEdit` sets
  `patch.value = 'img/' + prep.name` *after* validation — "the browser
  never picks the path." A user-chosen path is a user-chosen write
  location.
- **Weight is a quality gate you can't schema-check.** A 5 MB photo is
  valid JSON, valid schema, valid PNG — and a terrible web page.
  `warnOnHeavyImages` (500 KB per file, 2 MB per folder) warns on stderr
  with a one-sentence fix but never fails the build: it's advice about
  quality, not a violation of correctness, and the build distinguishes
  the two (see [atlas 10](10-error-handling.md)).
- **Uploads stay in the candidate until publish.** Bytes land in the
  candidate's `img/`; only `publish()` copies them to live, and a
  discarded session deletes them with the candidate. Even file writes
  follow the preview-first model (proof 8 covers this).

## Why here, why this way

Images are the one place owners hand the system *binary* data, so they
get the system's deepest defense stack: compress in the browser
(courtesy), allowlist the extension, cap the size, verify the bytes,
sanitize the name, assign the path server-side, stage in the candidate,
publish atomically with the content that references them. Each layer
catches what the previous one can't. That's **defense in depth** — the
through-line of [atlas 13](13-security-mindset.md).
