#!/usr/bin/env node
'use strict';
/* ============================================================
   engine/sitemap.js — CLI wrapper for the edit-map generator

   Usage: node engine/sitemap.js <client>
   Prints the compact edit map for a client to stdout so a developer
   (or the UI later) can see exactly what the maintenance model will be shown.

   v2: loads the client's theme tokens.json (when present) so the
   THEME TOKENS section shows effective values, not just overrides.
   ============================================================ */

const fs   = require('fs');
const path = require('path');
const { renderEditMap } = require('./lib/sitemap');

const clientName = process.argv[2];
if (!clientName) {
  console.error('Usage: node engine/sitemap.js <client>');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const contentPath = path.join(ROOT, 'clients', clientName, 'content.json');
if (!fs.existsSync(contentPath)) {
  console.error(`Error: ${contentPath} not found`);
  process.exit(1);
}

const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

let presetTokens = null;
const theme = (content.site && content.site.theme) || 'default';
const tokensPath = path.join(ROOT, 'themes', theme, 'tokens.json');
if (fs.existsSync(tokensPath)) {
  presetTokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
}

console.log(renderEditMap(content, presetTokens));
