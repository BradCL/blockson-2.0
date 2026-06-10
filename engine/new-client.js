#!/usr/bin/env node
'use strict';
/* ============================================================
   engine/new-client.js — Client scaffolder (setup tier)

   Usage: node engine/new-client.js <client-name> [theme]

   Creates clients/<client-name>/ with a minimal, schema-valid
   starter content.json on the chosen theme preset and an empty
   img/ folder, then prints next steps. Refuses to overwrite an
   existing client. Pure convenience for the "set and forget"
   workflow — nothing here is reachable by the maintenance tier.
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const name   = process.argv[2];
const theme  = process.argv[3] || 'default';

if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('Usage: node engine/new-client.js <client-name> [theme]');
  console.error('Client names: lowercase letters, digits, hyphens (e.g. "smith-plumbing").');
  process.exit(1);
}

const clientDir = path.join(ROOT, 'clients', name);
if (fs.existsSync(clientDir)) {
  console.error(`Error: clients/${name}/ already exists — refusing to overwrite.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, 'themes', theme, 'tokens.json'))) {
  console.error(`Error: themes/${theme}/tokens.json not found. Available themes:`);
  for (const t of fs.readdirSync(path.join(ROOT, 'themes'), { withFileTypes: true })) {
    if (t.isDirectory()) console.error(`  - ${t.name}`);
  }
  process.exit(1);
}

const pretty = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const starter = {
  site: {
    name: pretty,
    baseUrl: `https://${name}.example.com`,
    theme: theme,
    logo: { white: 'img/logo-white.png', black: 'img/logo-black.png', favicon: 'img/favicon.png' },
    contact: { phone: '000-000-0000', email: `hello@${name}.example.com` },
    nav: {
      links: [{ label: 'Home', href: 'index.html' }],
      cta: { label: 'Contact', href: 'contact.html' }
    },
    footer: {
      blurb: `${pretty} — replace this with a one-line description of the business.`,
      columns: [
        { heading: 'Pages', items: [
          { label: 'Home', href: 'index.html' },
          { label: 'Contact', href: 'contact.html' }
        ]},
        { heading: 'Contact', items: [
          { label: '000-000-0000', href: 'tel:0000000000' },
          { label: 'Email Us', href: `mailto:hello@${name}.example.com` }
        ]}
      ]
    },
    copyright: `© ${new Date().getFullYear()} ${pretty}. All rights reserved.`
  },
  pages: [
    {
      slug: 'index',
      meta: { title: pretty, description: `Replace with a 150-character description of ${pretty}.` },
      blocks: [
        { id: 'home-hero', type: 'hero', fields: {
          tag: 'Your town, your trade',
          headline: 'Replace this headline.',
          subhead: 'One sentence on what the business does and for whom.',
          background: 'img/banner.jpg',
          actions: [{ label: 'Get in Touch', href: 'contact.html', style: 'primary' }]
        }},
        { id: 'home-cta', type: 'cta', fields: {
          statement: 'Ready to get started?',
          button: { label: 'Contact Us', href: 'contact.html', style: 'primary' }
        }}
      ]
    },
    {
      slug: 'contact',
      meta: { title: `Contact | ${pretty}`, description: 'Get in touch.' },
      blocks: [
        { id: 'contact-header', type: 'page-header', fields: {
          tag: 'Contact', heading: "Let's talk"
        }},
        { id: 'contact-info', type: 'contact-info', fields: {
          items: [
            { id: 'info-phone', icon: 'phone', label: 'Call', value: '000-000-0000', href: 'tel:0000000000' },
            { id: 'info-email', icon: 'mail', label: 'Email', value: 'Email Us', href: `mailto:hello@${name}.example.com` }
          ]
        }}
      ]
    }
  ]
};

fs.mkdirSync(path.join(clientDir, 'img'), { recursive: true });
fs.writeFileSync(path.join(clientDir, 'content.json'), JSON.stringify(starter, null, 2) + '\n', 'utf8');

console.log(`Created clients/${name}/ on theme "${theme}".`);
console.log('Next steps:');
console.log(`  1. Add images to clients/${name}/img/ (logo-white.png, logo-black.png, favicon.png, banner.jpg)`);
console.log(`  2. Edit clients/${name}/content.json (see BLOCK_CATALOG.md for all 21 block types)`);
console.log(`  3. node engine/build.js ${name}`);
