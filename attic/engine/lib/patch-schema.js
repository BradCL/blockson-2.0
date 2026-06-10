/* ============================================================
   engine/lib/patch-schema.js — Per-request patch schema (v3)

   Builds a JSON Schema describing the ONLY patch a maintenance
   model may emit for THIS client right now: `block` is an enum of
   the real block ids (+ "site"), `item` an enum of the real item
   ids, `token` an enum of the safe tokens. Pass the result as
   Ollama's `format` (structured outputs): the sampler is then
   grammar-constrained and the model *cannot* hallucinate an
   address — `block:"copyright"` becomes unrepresentable instead
   of merely discouraged. This is the difference between asking a
   1B model to be careful and making carelessness impossible.

   The schema constrains SHAPE, not safety: every emitted patch
   still flows through repairPatch (normalization) and applyPatch
   (the allowlist) exactly as before.

   Export:
     buildPatchSchema(content) -> JSON Schema object
   ============================================================ */

'use strict';

const { indexHosts, SAFE_TOKENS } = require('./patch');

// Collect every addressable item id (objects carrying a string id)
// inside any block's fields.
function collectItemIds(content) {
  const ids = new Set();
  (function walk(node) {
    if (Array.isArray(node)) { for (const el of node) walk(el); return; }
    if (node && typeof node === 'object') {
      if (typeof node.id === 'string') ids.add(node.id);
      for (const k of Object.keys(node)) walk(node[k]);
    }
  })(((content && content.pages) || []).map(pg => (pg.blocks || []).map(b => b.fields)));
  return [...ids];
}

/* Build one schema branch per action. With additionalProperties:false on
   each branch, a grammar-constrained model literally cannot emit a
   set-token without a value, or a refuse carrying a block — the shape
   is unrepresentable, not merely discouraged.
   `allowedActions` (optional) restricts which branches are offered for
   THIS request (used by the triage pre-filter, engine/lib/triage.js). */
function buildPatchSchema(content, allowedActions) {
  const blockIds = [...indexHosts(content).keys()];          // includes "site"
  const itemIds  = collectItemIds(content);
  const tokens   = Object.keys(SAFE_TOKENS).map(n => '--' + n);

  const blockProp = { type: 'string', enum: blockIds };
  const itemProp  = itemIds.length ? { type: 'string', enum: itemIds } : { type: 'string' };

  const branches = {
    'set': {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set'] },
        block:  blockProp,
        item:   itemProp,
        field:  { type: 'string' },
        value:  { type: ['string', 'number'] },
        match:  { type: 'string' },
      },
      required: ['action', 'block', 'field', 'value'],
      additionalProperties: false,
    },
    'append': {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['append'] },
        block:  blockProp,
        item:   itemProp,
        field:  { type: 'string' },
        value:  { type: 'string' },
      },
      required: ['action', 'block', 'field', 'value'],
      additionalProperties: false,
    },
    'delete': {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['delete'] },
        block:  blockProp,
        item:   itemProp,
        field:  { type: 'string' },
        match:  { type: 'string' },
      },
      required: ['action', 'block', 'field', 'match'],
      additionalProperties: false,
    },
    'set-token': {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set-token'] },
        token:  { type: 'string', enum: tokens },
        value:  { type: 'string' },
      },
      required: ['action', 'token', 'value'],
      additionalProperties: false,
    },
    'refuse': {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['refuse'] },
        reason: { type: 'string' },
      },
      required: ['action', 'reason'],
      additionalProperties: false,
    },
  };

  const offered = (Array.isArray(allowedActions) && allowedActions.length)
    ? allowedActions.filter(a => branches[a])
    : Object.keys(branches);

  // "refuse" is always representable — the model must always have an exit.
  if (!offered.includes('refuse')) offered.push('refuse');

  return { anyOf: offered.map(a => branches[a]) };
}

module.exports = { buildPatchSchema };
