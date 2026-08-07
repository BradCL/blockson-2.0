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

// Pre-populate the schema cache so validate() never reaches the filesystem.
// Inert on the Node path (never called — the lazy fs load above stands); the
// browser bundle calls this once at startup with the inlined schema so the
// engine validates in-browser without fs.
function setSchema(schema) { _schema = schema; }

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
  const contractErrors = validateExtendedContracts(content);
  if (contractErrors.length) return { ok: false, errors: contractErrors };
  return { ok: true, errors: [] };
}

// Mirrors $defs/safeHref in content.schema.json: a link target is either a
// known-safe scheme or carries no scheme at all (relative path / anchor).
// Keeping a copy here means the scheme guard holds even when AJV is absent.
const SAFE_HREF_RE = /^(?:(?:https?:\/\/|mailto:|tel:|sms:|#).*|[^:]*)$/;
// Keys that carry a $defs/safeHref link target. `href` covers nav, footer,
// buttons and album links; `link` is the photo-strip / card-grid doorway,
// which the AJV path has always scheme-checked and this fallback used to miss.
const SAFE_HREF_KEYS = new Set(['href', 'link']);
// Keys whose values become iframe/form/network targets: https only.
// `url` is the reviews-link outbound profile link — an external listing must
// be https (the schema enforces the same pattern on the AJV path).
const HTTPS_ONLY_KEYS = new Set(['formAction', 'mapEmbedUrl', 'videoUrl', 'url']);
const FORM_FIELD_TYPES = new Set([
  'text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'checkbox',
]);
const GOOGLE_TAG_RE = /^(?:G|GT|AW|DC)-[A-Z0-9]+$/;
const GOOGLE_ANALYTICS_RE = /^G-[A-Z0-9]+$/;
const GOOGLE_ADS_RE = /^AW-[0-9]+$/;
const SEARCH_CONSOLE_RE = /^[A-Za-z0-9_-]{10,100}$/;
const META_PIXEL_RE = /^[0-9]{5,20}$/;
const CLARITY_PROJECT_RE = /^[a-z0-9]{8,20}$/;
const OSPREY_TENANT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLIENT_SCRIPT_RE = /^js\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/;
const FORM_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const HONEYPOT_NAMES = new Set(['_gotcha', '_company_url']);

// The AJV-free build path still renders integrations and enhanced forms, so
// their narrow allowlists cannot depend on AJV being installed. These checks
// also add the cross-field facts JSON Schema cannot express cleanly: unique
// field names and conditional hooks that point at a real sibling field.
function validateExtendedContracts(content) {
  const errors = [];
  const integrations = content && content.site && content.site.integrations;
  if (integrations !== undefined) {
    if (!integrations || typeof integrations !== 'object' || Array.isArray(integrations)) {
      errors.push('site.integrations must be an object');
    } else {
      const allowed = new Set([
        'searchConsoleVerification', 'googleTagId', 'google', 'clarityProjectId',
        'metaPixelId', 'ospreyTenant', 'clientScript',
      ]);
      const keys = Object.keys(integrations);
      if (!keys.length) errors.push('site.integrations must configure at least one integration');
      for (const key of keys) {
        if (!allowed.has(key)) errors.push(`site.integrations has unknown property "${key}"`);
      }
      if (integrations.googleTagId !== undefined
          && (typeof integrations.googleTagId !== 'string' || !GOOGLE_TAG_RE.test(integrations.googleTagId))) {
        errors.push('site.integrations.googleTagId must be a Google tag id beginning G-, GT-, AW-, or DC-');
      }
      if (integrations.searchConsoleVerification !== undefined
          && (typeof integrations.searchConsoleVerification !== 'string'
            || !SEARCH_CONSOLE_RE.test(integrations.searchConsoleVerification))) {
        errors.push('site.integrations.searchConsoleVerification must be a 10-100 character Search Console token containing only letters, digits, _ or -');
      }
      if (integrations.google !== undefined) {
        const google = integrations.google;
        if (!google || typeof google !== 'object' || Array.isArray(google)) {
          errors.push('site.integrations.google must be an object');
        } else {
          for (const key of Object.keys(google)) {
            if (key !== 'analyticsId' && key !== 'adsId') {
              errors.push(`site.integrations.google has unknown property "${key}"`);
            }
          }
          if (typeof google.analyticsId !== 'string' || !GOOGLE_ANALYTICS_RE.test(google.analyticsId)) {
            errors.push('site.integrations.google.analyticsId must be a GA4 id beginning G-');
          }
          if (typeof google.adsId !== 'string' || !GOOGLE_ADS_RE.test(google.adsId)) {
            errors.push('site.integrations.google.adsId must be a Google Ads id beginning AW- followed by digits');
          }
        }
      }
      if (integrations.googleTagId !== undefined && integrations.google !== undefined) {
        errors.push('site.integrations must use either legacy googleTagId or google, not both');
      }
      if (integrations.metaPixelId !== undefined
          && (typeof integrations.metaPixelId !== 'string' || !META_PIXEL_RE.test(integrations.metaPixelId))) {
        errors.push('site.integrations.metaPixelId must be 5–20 digits');
      }
      if (integrations.clarityProjectId !== undefined
          && (typeof integrations.clarityProjectId !== 'string'
            || !CLARITY_PROJECT_RE.test(integrations.clarityProjectId))) {
        errors.push('site.integrations.clarityProjectId must be 8-20 lowercase letters or digits');
      }
      if (integrations.ospreyTenant !== undefined
          && (typeof integrations.ospreyTenant !== 'string'
            || integrations.ospreyTenant.length < 3
            || integrations.ospreyTenant.length > 63
            || !OSPREY_TENANT_RE.test(integrations.ospreyTenant))) {
        errors.push('site.integrations.ospreyTenant must be a 3-63 character lowercase tenant slug');
      }
      if (integrations.clientScript !== undefined
          && (typeof integrations.clientScript !== 'string'
            || !CLIENT_SCRIPT_RE.test(integrations.clientScript)
            || integrations.clientScript === 'js/main.js')) {
        errors.push('site.integrations.clientScript must be a safe js/*.js path other than js/main.js');
      }
    }
  }

  for (const [pi, page] of (content.pages || []).entries()) {
    const formIds = new Set();
    const statusIds = new Set();
    for (const [bi, block] of (page.blocks || []).entries()) {
      if (!block || (block.type !== 'contact-form' && block.type !== 'hero-form')) continue;
      const spec = block.type === 'hero-form'
        ? block.fields && block.fields.form
        : block.fields;
      const fields = spec && Array.isArray(spec.fields) ? spec.fields : [];
      const specWhere = `pages[${pi}].blocks[${bi}].fields${block.type === 'hero-form' ? '.form' : ''}`;
      const where = `${specWhere}.fields`;
      const names = new Map();
      const crmConfigured = !!(integrations && integrations.clientScript);
      if (!spec || typeof spec !== 'object') continue;
      if (crmConfigured && !spec.formId) {
        errors.push(`${specWhere}.formId is required when site.integrations.clientScript is configured`);
      } else if (spec.formId !== undefined && (typeof spec.formId !== 'string' || !FORM_NAME_RE.test(spec.formId))) {
        errors.push(`${specWhere}.formId must begin with a letter and contain only letters, digits, _ or -`);
      } else if (spec.formId && formIds.has(spec.formId)) {
        errors.push(`${specWhere}.formId duplicates "${spec.formId}" on this page`);
      } else if (spec.formId) {
        formIds.add(spec.formId);
      }
      if (crmConfigured && !spec.statusId) {
        errors.push(`${specWhere}.statusId is required when site.integrations.clientScript is configured`);
      } else if (spec.statusId !== undefined && (typeof spec.statusId !== 'string' || !FORM_NAME_RE.test(spec.statusId))) {
        errors.push(`${specWhere}.statusId must begin with a letter and contain only letters, digits, _ or -`);
      } else if (spec.statusId && statusIds.has(spec.statusId)) {
        errors.push(`${specWhere}.statusId duplicates "${spec.statusId}" on this page`);
      } else if (spec.statusId) {
        statusIds.add(spec.statusId);
      }
      if (spec.honeypotName !== undefined && !HONEYPOT_NAMES.has(spec.honeypotName)) {
        errors.push(`${specWhere}.honeypotName must be _gotcha or _company_url`);
      }
      for (const [fi, field] of fields.entries()) {
        if (!field || typeof field !== 'object') continue;
        if (crmConfigured && (typeof field.name !== 'string' || !FORM_NAME_RE.test(field.name))) {
          errors.push(`${where}[${fi}].name must begin with a letter and contain only letters, digits, _ or -`);
        } else if (crmConfigured && names.has(field.name)) {
          errors.push(`${where}[${fi}].name duplicates "${field.name}"`);
        } else {
          names.set(field.name, field);
        }
        if (typeof field.type === 'string' && !FORM_FIELD_TYPES.has(field.type)) {
          errors.push(`${where}[${fi}].type is not an allowed form field type`);
        }
      }
      for (const [fi, field] of fields.entries()) {
        if (!field || !field.showWhen || typeof field.showWhen !== 'object') continue;
        const target = names.get(field.showWhen.field);
        if (!target) {
          errors.push(`${where}[${fi}].showWhen.field must name another field in the same form`);
        } else if (target === field) {
          errors.push(`${where}[${fi}].showWhen.field cannot refer to itself`);
        } else if (target.type === 'select' && Array.isArray(target.options)
            && !target.options.includes(field.showWhen.equals)) {
          errors.push(`${where}[${fi}].showWhen.equals must match an option on "${field.showWhen.field}"`);
        }
      }
    }
  }
  return errors;
}

function scanLinkTargets(node, where, errors) {
  if (Array.isArray(node)) {
    node.forEach((el, i) => scanLinkTargets(el, `${where}[${i}]`, errors));
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (SAFE_HREF_KEYS.has(k) && typeof v === 'string' && !SAFE_HREF_RE.test(v)) {
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
  errors.push(...validateExtendedContracts(content));

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

// fallbackValidate is exported so the reduced, AJV-free guard can be probed
// directly (proof 33) instead of only through a build with the packages made
// unresolvable — its scheme checks are the last line when AJV is absent.
module.exports = { validate, setSchema, fallbackValidate, validateExtendedContracts };
