/* A minimal Buffer shim, injected as the `Buffer` global into the demo bundle
   (esbuild `inject`). owner.js uses Buffer only to size and decode an uploaded
   image's base64 and to read its magic bytes — Buffer.byteLength, Buffer.from
   (base64), then byte indexing / .length / .toString('latin1', s, e). This
   covers exactly those, so the same image-upload guards (extension allowlist,
   size cap, file-signature check) run unchanged in the browser. Node keeps the
   real Buffer; this exists only in the demo build. */
'use strict';

function decodeBase64(str) {
  const clean = String(str || '').replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  // Only 'latin1' is ever requested (the GIF/WebP/AVIF signature checks).
  out.toString = function (enc, start, end) {
    const a = start || 0;
    const b = end == null ? out.length : end;
    let s = '';
    for (let i = a; i < b; i++) s += String.fromCharCode(out[i]);
    return s;
  };
  return out;
}

export const Buffer = {
  from(data, enc) {
    if (typeof data === 'string') return decodeBase64(enc === 'base64' ? data : btoa(data));
    return new Uint8Array(data);
  },
  byteLength(str, enc) {
    if (enc === 'base64') return decodeBase64(str).length;
    return new TextEncoder().encode(String(str)).length;
  },
};
