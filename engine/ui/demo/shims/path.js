/* Tiny POSIX-ish path shim for the demo bundle. owner.js uses only basename
   and extname (on upload filenames); scaffold.js and validate.js reference
   resolve/join at import time to compute paths they never use in the browser
   (the blueprint-registry and schema reads are short-circuited by the Phase-1
   setters). So basename/extname are real; the rest just produce a harmless
   string without throwing. Aliased in place of Node's "path" only in the demo
   build — the Node engine keeps the real module. */
'use strict';

function basename(p, ext) {
  let s = String(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  s = i === -1 ? s : s.slice(i + 1);
  if (ext && s.endsWith(ext)) s = s.slice(0, -ext.length);
  return s;
}

function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
}

function join() {
  return Array.prototype.slice.call(arguments)
    .filter(Boolean).join('/').replace(/\/+/g, '/');
}

function resolve() {
  return '/' + join.apply(null, arguments).replace(/^\/+/, '');
}

function dirname(p) {
  const s = String(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i === -1 ? '.' : s.slice(0, i) || '/';
}

function normalize(p) { return String(p).replace(/\/+/g, '/'); }

module.exports = { basename, extname, join, resolve, dirname, normalize, sep: '/' };
module.exports.posix = module.exports;
