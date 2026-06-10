'use strict';

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const re  = /[&<>"']/g;

function esc(str) {
  if (str == null) return '';
  return String(str).replace(re, c => MAP[c]);
}

function escAttr(str) {
  return esc(str);
}

module.exports = { esc, escAttr };
