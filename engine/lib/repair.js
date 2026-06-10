/* ============================================================
   engine/lib/repair.js — Deterministic patch repair pass (v3.1)

   Small local models produce a recognisable family of NEAR-MISS
   patches: the value is right but the addressing is one canonical
   transformation away from valid (e.g. live-model testing showed
   gemma3:4b emitting {block:"copyright", field:"value"} instead of
   {block:"site", field:"copyright"} on every client).

   This module rewrites ONLY those known shapes, deterministically,
   BEFORE the resolver. It grants no new capability:
   - every rewrite targets something that already exists in content,
   - the rewritten patch still passes through applyPatch's full
     allowlist (forbidden keys, containers, themeOverrides block,
     token format + contrast guards),
   - anything it doesn't positively recognise is returned untouched
     for the resolver to reject as before.

   Returns { patch, repairs } where repairs is an array of
   human-readable notes (empty = nothing changed). The input patch
   is never mutated.
   ============================================================ */

'use strict';

const { indexHosts, findItemById } = require('./patch');

const ALLOWED_KEYS = new Set(['action', 'block', 'item', 'field', 'value', 'match', 'reason', 'token']);
const STRUCTURAL_TAILS = new Set(['id', 'type', 'slug']);

// True if `path` (dotted) resolves to an existing SCALAR on the site
// object, is not structural, and is not the token store.
function siteScalarExists(site, pathStr) {
  if (typeof pathStr !== 'string' || !pathStr) return false;
  const parts = pathStr.split('.');
  if (parts[0] === 'themeOverrides') return false;          // set-token territory
  if (STRUCTURAL_TAILS.has(parts[parts.length - 1])) return false;
  let cur = site;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur) || !(p in cur)) return false;
    cur = cur[p];
  }
  return cur === null || typeof cur !== 'object';
}

// True if `pathStr` (dotted) resolves to an existing key chain on `obj`.
function pathExistsOn(obj, pathStr) {
  let cur = obj;
  for (const seg of String(pathStr).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) return false;
    cur = cur[seg];
  }
  return true;
}

function repairPatch(content, patch) {
  const repairs = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { patch, repairs };
  const p = { ...patch };

  // Rule 1 — strip keys outside the patch vocabulary (models occasionally
  // invent "label"/"items"/"id" keys; the allowed keys are the contract).
  for (const k of Object.keys(p)) {
    if (!ALLOWED_KEYS.has(k)) {
      delete p[k];
      repairs.push(`dropped unknown key "${k}"`);
    }
  }

  // Rule 1b — an EMPTY "match" is meaningless and would shunt the patch
  // down the match path (live 4b runs emitted match:"" alongside a plain
  // field write). Drop it so the resolver takes the plain-set path.
  if (typeof p.match === 'string' && p.match.trim() === '') {
    delete p.match;
    repairs.push('dropped empty "match"');
  }

  // Rule 2 — token name landed in "field" or "block" on a set-token patch.
  if (p.action === 'set-token' && typeof p.token !== 'string') {
    for (const slot of ['field', 'block']) {
      if (typeof p[slot] === 'string' && /^--/.test(p[slot])) {
        p.token = p[slot];
        delete p[slot];
        repairs.push(`moved token name from "${slot}" to "token"`);
        break;
      }
    }
  }
  // set-token never carries block/field — remove leftovers so the shape is canonical.
  if (p.action === 'set-token') {
    for (const slot of ['block', 'field', 'item', 'match']) {
      if (slot in p) { delete p[slot]; repairs.push(`removed "${slot}" from set-token patch`); }
    }
  }

  // Rule 2b — half-formed set-token: no usable value. Live-model testing
  // (gemma3:4b) showed models emitting {action:"set-token", token, reason}
  // with the value buried in prose, or with a reason that is semantically a
  // refusal ("...refer to the developer"). Downgrade to an explicit refusal.
  // Strictly capability-REDUCING: a would-be write becomes a non-write, so
  // this can never grant anything the resolver would have blocked.
  if (p.action === 'set-token' && typeof p.value !== 'string') {
    p.action = 'refuse';
    delete p.token;
    delete p.value;
    if (typeof p.reason !== 'string' || !p.reason.trim()) {
      p.reason = 'The request could not be completed safely; refer to the developer.';
    }
    repairs.push('downgraded valueless set-token to refuse');
  }

  // Rule 3 — block/field conflation on site-wide scalars: the model wrote
  // the FIELD NAME into "block" (with field empty, "value", or the tail of
  // the dotted path). Rewrite only when the target provably exists as a
  // site scalar. This is the single most common small-model error.
  if (p.action === 'set' && typeof p.block === 'string' && p.block !== 'site') {
    const hosts = indexHosts(content);
    if (!hosts.has(p.block)) {
      const site = (content && content.site) || {};
      const fieldIsPlaceholder = p.field == null || p.field === 'value' || p.field === p.block;
      const joined = !fieldIsPlaceholder ? `${p.block}.${p.field}` : null;
      if (fieldIsPlaceholder && siteScalarExists(site, p.block)) {
        repairs.push(`rewrote block:"${p.block}" → block:"site", field:"${p.block}"`);
        p.field = p.block;
        p.block = 'site';
      } else if (joined && siteScalarExists(site, joined)) {
        repairs.push(`rewrote block:"${p.block}", field:"${p.field}" → block:"site", field:"${joined}"`);
        p.field = joined;
        p.block = 'site';
      }
    }
  }

  // Rule 4 — item id embedded in the dotted field path. Live 4b runs emit
  //   {block:"home-services", field:"cards.card-renovations.body"}
  //   {block:"home-offerings", field:"items.card-dinein.body"}
  // instead of {item:"card-renovations", field:"body"}. Rewrite ONLY when
  // a path segment is a PROVABLY EXISTING item id inside the named block
  // and the remaining tail resolves to a real, non-structural field on
  // that item. Never invents an id, never bypasses the resolver.
  if ((p.action === 'set' || p.action === 'append')
    && typeof p.block === 'string' && typeof p.field === 'string' && p.field.includes('.')) {
    const hosts = indexHosts(content);
    const host = hosts.get(p.block);
    if (host) {
      const parts = p.field.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        const item = findItemById(host, parts[i]);
        if (!item) continue;
        const tail = parts.slice(i + 1).join('.');
        const tailEnd = tail.split('.').pop();
        const itemSlotFree = p.item == null || p.item === parts[i];
        if (tail && !STRUCTURAL_TAILS.has(tailEnd) && itemSlotFree && pathExistsOn(item, tail)) {
          repairs.push(`rewrote field:"${p.field}" → item:"${parts[i]}", field:"${tail}"`);
          p.item = parts[i];
          p.field = tail;
        }
        break; // first id segment decides; never scan past it
      }
    }
  }

  return { patch: p, repairs };
}

module.exports = { repairPatch };