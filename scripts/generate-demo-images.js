#!/usr/bin/env node
/**
 * generate-demo-images.js — locally generated placeholder art for the
 * wren-and-willow tutorial client. No network, no stock photos: every
 * asset is an SVG composition rendered to PNG/JPEG with sharp, on the
 * salon theme's brand palette, so the demo screenshots look intentional.
 *
 *   node scripts/generate-demo-images.js
 *
 * Idempotent: overwrites clients/wren-and-willow/img/ outputs in place.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'clients', 'wren-and-willow', 'img');
fs.mkdirSync(OUT, { recursive: true });

// Salon theme palette (themes/salon/tokens.json) + tints derived from it.
const P = {
  bg: '#fbf7f5', surface: '#ffffff', text: '#33272b', muted: '#8a7a80',
  rose: '#b46a7d', gold: '#caa46a',
  roseLight: '#d8a7b5', blush: '#f3e3e7', mauve: '#4a3740', deep: '#33272b',
};
const SERIF = "Georgia, 'Times New Roman', serif";
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const svgDoc = (w, h, body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

const jpeg = (svg, file) => sharp(svg).jpeg({ quality: 82 }).toFile(path.join(OUT, file));
const png = (svg, file) => sharp(svg).png().toFile(path.join(OUT, file));

/* Deterministic pseudo-random from a string seed, so regeneration is stable. */
function rng(seed) {
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/* The house style: soft two-tone gradient, translucent overlapping circles
   ("waves of hair"), one thin gold ring, an optional serif label. */
function composition(w, h, seed, { from, to, ink, label, sub, dark = false } = {}) {
  const r = rng(seed);
  let shapes = '';
  for (let i = 0; i < 5; i++) {
    const cx = w * (0.15 + r() * 0.7), cy = h * (0.1 + r() * 0.8);
    const rad = Math.min(w, h) * (0.18 + r() * 0.35);
    const col = [P.rose, P.gold, P.roseLight, dark ? P.mauve : P.blush][Math.floor(r() * 4)];
    shapes += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="${col}" opacity="${(0.14 + r() * 0.2).toFixed(2)}"/>`;
  }
  const ringR = Math.min(w, h) * 0.3;
  shapes += `<circle cx="${(w * 0.72).toFixed(0)}" cy="${(h * 0.35).toFixed(0)}" r="${ringR.toFixed(0)}" fill="none" stroke="${P.gold}" stroke-width="${Math.max(2, w / 320)}" opacity="0.55"/>`;
  const text = label ? `
    <text x="${w / 2}" y="${h * 0.56}" font-family="${SERIF}" font-style="italic" font-size="${Math.round(h * 0.11)}" fill="${ink}" text-anchor="middle">${esc(label)}</text>
    ${sub ? `<text x="${w / 2}" y="${h * 0.56 + h * 0.09}" font-family="${SERIF}" font-size="${Math.round(h * 0.035)}" letter-spacing="${Math.round(w / 160)}" fill="${ink}" opacity="0.7" text-anchor="middle">${esc(sub.toUpperCase())}</text>` : ''}` : '';
  return `
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}${text}`;
}

/* Wordmark: two crossed leaf/feather ellipses + serif name + spaced subtitle. */
function logo(w, h, ink, accent) {
  const lx = 70, ly = h / 2;
  return `
    <g transform="translate(${lx} ${ly})">
      <ellipse rx="34" ry="13" transform="rotate(-35)" fill="none" stroke="${accent}" stroke-width="4"/>
      <ellipse rx="34" ry="13" transform="rotate(35)" fill="none" stroke="${ink}" stroke-width="4"/>
    </g>
    <text x="130" y="${h / 2 + 12}" font-family="${SERIF}" font-size="52" fill="${ink}">Wren &amp; Willow</text>
    <text x="133" y="${h / 2 + 46}" font-family="${SERIF}" font-size="19" letter-spacing="11" fill="${accent}">HAIR STUDIO</text>`;
}

async function main() {
  const jobs = [];

  // Logos (transparent PNG) + favicon
  jobs.push(png(svgDoc(560, 150, logo(560, 150, '#ffffff', P.gold)), 'logo-white.png'));
  jobs.push(png(svgDoc(560, 150, logo(560, 150, P.deep, P.rose)), 'logo-black.png'));
  jobs.push(png(svgDoc(64, 64, `
    <circle cx="32" cy="32" r="32" fill="${P.rose}"/>
    <text x="32" y="45" font-family="${SERIF}" font-size="38" fill="#ffffff" text-anchor="middle">W</text>`), 'favicon.png'));

  // Hero banner — deep mauve gradient so the white hero text reads.
  jobs.push(jpeg(svgDoc(1920, 1080, composition(1920, 1080, 'banner', {
    from: P.deep, to: P.mauve, ink: P.blush, dark: true,
  })), 'banner.jpg'));

  // Team portraits — abstract avatars: tinted field + initial medallion.
  const team = [
    ['maren', 'M', P.rose], ['sofia', 'S', P.gold], ['jules', 'J', P.roseLight], ['priya', 'P', P.mauve],
  ];
  for (const [name, initial, tint] of team) {
    jobs.push(jpeg(svgDoc(480, 600, `
      ${composition(480, 600, 'team-' + name, { from: P.blush, to: P.bg, ink: P.deep })}
      <circle cx="240" cy="260" r="120" fill="${tint}"/>
      <circle cx="240" cy="260" r="132" fill="none" stroke="${P.gold}" stroke-width="3" opacity="0.7"/>
      <text x="240" y="305" font-family="${SERIF}" font-size="130" fill="#ffffff" text-anchor="middle">${initial}</text>`), `team-${name}.jpg`));
  }

  // Before/after pairs — "before" muted, "after" saturated, badge text.
  const ba = [['balayage', 'Balayage refresh'], ['silver', 'Silver transition']];
  for (const [slug, title] of ba) {
    jobs.push(jpeg(svgDoc(800, 600, composition(800, 600, 'ba-' + slug + '-b', {
      from: '#cfc6c9', to: '#a99aa0', ink: P.deep, label: title, sub: 'before',
    })), `ba-${slug}-before.jpg`));
    jobs.push(jpeg(svgDoc(800, 600, composition(800, 600, 'ba-' + slug + '-a', {
      from: P.roseLight, to: P.gold, ink: P.deep, label: title, sub: 'after',
    })), `ba-${slug}-after.jpg`));
  }

  // Gallery — four albums, two shots each, labelled like portfolio cards.
  const albums = [
    ['balayage', 'Balayage', P.roseLight, P.gold],
    ['vivids', 'Vivid Colour', P.rose, P.mauve],
    ['cuts', 'Precision Cuts', P.blush, P.roseLight],
    ['bridal', 'Bridal & Events', P.bg, P.gold],
  ];
  for (const [slug, label, from, to] of albums) {
    for (const n of [1, 2]) {
      jobs.push(jpeg(svgDoc(800, 600, composition(800, 600, `gal-${slug}-${n}`, {
        from, to, ink: P.deep, label, sub: `studio work ${n}`,
      })), `gal-${slug}-${n}.jpg`));
    }
  }

  await Promise.all(jobs);
  const files = fs.readdirSync(OUT);
  console.log(`Generated ${files.length} assets into clients/wren-and-willow/img/`);
  for (const f of files.sort()) {
    console.log(`  ${f}  (${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
