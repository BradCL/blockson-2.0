'use strict';

const fs   = require('fs');
const path = require('path');

let Ajv, addFormats;
try {
  Ajv        = require('ajv/dist/2020');
  addFormats = require('ajv-formats');
} catch (e) {
  Ajv = addFormats = null;
}

let _schema = null;
function loadSchema() {
  if (!_schema) {
    const schemaPath = path.join(__dirname, '..', 'schema', 'content.schema.json');
    _schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  }
  return _schema;
}

function formatErrors(errors) {
  // Suppress the generic "must match then schema" wrapper — the nested required/type
  // errors that caused it are already reported and are more actionable.
  const filtered = errors.filter(e => e.keyword !== 'if' && e.keyword !== 'then');
  return filtered.map(err => {
    const p     = err.instancePath || '';
    const field = p.replace(/^\//, '').replace(/\//g, '.');
    if (err.keyword === 'required') {
      const missing = err.params && err.params.missingProperty;
      return `${field ? field + '.' : ''}${missing} is required`;
    }
    if (err.keyword === 'enum') {
      return `${field} must be one of: ${err.params.allowedValues.join(', ')}`;
    }
    if (err.keyword === 'type') {
      return `${field} must be ${err.params.type}`;
    }
    if (err.keyword === 'additionalProperties') {
      return `${field} has unknown property "${err.params.additionalProperty}"`;
    }
    return `${field} ${err.message}`;
  });
}

function validate(content) {
  const schema = loadSchema();

  if (!Ajv) {
    const result = fallbackValidate(content);
    result.warnings = [
      'AJV not installed — field-level validation is disabled. Run: npm install',
    ];
    return result;
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  if (addFormats) addFormats(ajv);

  const valid = ajv.validate(schema, content);
  if (!valid) {
    return { ok: false, errors: formatErrors(ajv.errors) };
  }
  return { ok: true, errors: [] };
}

// Mirrors $defs/safeHref in content.schema.json: a link target is either a
// known-safe scheme or carries no scheme at all (relative path / anchor).
// Keeping a copy here means the scheme guard holds even when AJV is absent.
const SAFE_HREF_RE = /^(?:(?:https?:\/\/|mailto:|tel:|sms:|#).*|[^:]*)$/;
// Keys whose values become iframe/form/network targets: https only.
// `url` is the reviews-link outbound profile link — an external listing must
// be https (the schema enforces the same pattern on the AJV path).
const HTTPS_ONLY_KEYS = new Set(['formAction', 'mapEmbedUrl', 'videoUrl', 'url']);

function scanLinkTargets(node, where, errors) {
  if (Array.isArray(node)) {
    node.forEach((el, i) => scanLinkTargets(el, `${where}[${i}]`, errors));
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (k === 'href' && typeof v === 'string' && !SAFE_HREF_RE.test(v)) {
        errors.push(`${where}.${k}: "${v}" uses a disallowed URL scheme (allowed: https, http, mailto, tel, sms, or a relative path)`);
      } else if (HTTPS_ONLY_KEYS.has(k) && typeof v === 'string' && !/^https:\/\//.test(v)) {
        errors.push(`${where}.${k}: "${v}" must be an https:// URL`);
      } else if (k === 'successPath' && typeof v === 'string' && v.includes(':')) {
        errors.push(`${where}.${k}: "${v}" must be a relative path (no URL scheme)`);
      }
      scanLinkTargets(v, `${where}.${k}`, errors);
    }
  }
}

function fallbackValidate(content) {
  const errors = [];
  if (!content || typeof content !== 'object') {
    errors.push('content.json must be an object');
    return { ok: false, errors };
  }
  if (!content.site) errors.push('site is required');
  if (!Array.isArray(content.pages) || content.pages.length === 0) {
    errors.push('pages must be a non-empty array');
  }

  // Derived from the block registry — the single source of truth for what
  // block types exist — so the fallback can never drift from the engine.
  const VALID_TYPES = new Set(Object.keys(require('../blocks/_registry')));

  (content.pages || []).forEach((page, pi) => {
    if (!page.slug) errors.push(`pages[${pi}].slug is required`);
    if (!page.meta) errors.push(`pages[${pi}].meta is required`);
    (page.blocks || []).forEach((block, bi) => {
      if (!block.id)    errors.push(`pages[${pi}].blocks[${bi}].id is required`);
      if (!block.type)  errors.push(`pages[${pi}].blocks[${bi}].type is required`);
      if (block.type && !VALID_TYPES.has(block.type)) {
        errors.push(`pages[${pi}].blocks[${bi}].type "${block.type}" is not a registered block`);
      }
      if (!block.fields) errors.push(`pages[${pi}].blocks[${bi}].fields is required`);
    });
  });

  if (content.site) scanLinkTargets(content.site, 'site', errors);
  scanLinkTargets(content.pages || [], 'pages', errors);

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

module.exports = { validate };
