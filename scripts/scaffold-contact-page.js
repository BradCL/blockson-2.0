#!/usr/bin/env node
/**
 * scaffold-contact-page.js — developer-side blueprint instantiation, used
 * to add the wren-and-willow contact page from blueprints/contact-page.json
 * (the same scaffolder the owner editor's Add… menu calls).
 *
 *   node scripts/scaffold-contact-page.js
 *
 * One-shot: refuses to run again if a "contact" page already exists.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const scaffold = require('../engine/lib/scaffold');

const CONTENT = path.join(__dirname, '..', 'clients', 'wren-and-willow', 'content.json');
const content = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));

if (content.pages.some(p => p.slug === 'contact')) {
  console.error('A "contact" page already exists — nothing to do.');
  process.exit(1);
}

const bp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'blueprints', 'contact-page.json'), 'utf8'));

const result = scaffold.instantiate(content, bp, 'withForm', {
  menuLabel: 'Contact',
  title: 'Get in touch',
  intro: 'Call, email, or send us a message — we reply within one business day, usually faster.',
  address: '10318 124 Street NW, Edmonton',
  // Documented placeholder: passes the https:// guard, and every build
  // warns until real form delivery is configured (OPERATOR.md §8).
  formAction: 'https://UNCONFIGURED',
});

if (!result.ok) {
  console.error('Scaffold rejected:\n  ' + result.errors.join('\n  '));
  process.exit(1);
}

fs.writeFileSync(CONTENT, JSON.stringify(content, null, 2) + '\n');
console.log(`Created page "${result.created.slug}" (${result.created.file}) with blocks:`);
for (const id of result.created.blockIds) console.log(`  ${id}`);
console.log('Nav entry appended:', result.created.navLabel);
