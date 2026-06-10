'use strict';

// Inline SVG path data only — rendered inside wrapper elements that supply
// width/height/stroke. All icons use a 24×24 viewBox with stroke, no fill.
// The maintenance tier may only reference names that already exist here;
// it never adds SVGs. Extended (v2) with six names that serve the new
// business verticals: calendar, dollar, heart, paw, car, scissors.
const ICONS = {
  hammer:  '<path d="M15 3l6 6-9.5 9.5-6-6L15 3z"/><path d="M9.5 6.5l4 4"/><path d="M3 21l4-4"/>',
  wrench:  '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>',
  home:    '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  paint:   '<path d="M19 3H5a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"/><path d="M3 9v10a2 2 0 002 2h6"/><path d="M15 13v8"/><path d="M18 16l3 3-3 3"/>',
  leaf:    '<path d="M17 8C8 10 5.9 16.17 3.82 19.92A1 1 0 005 21l.5-.5C7 19 8 18 9 18c2 0 2 2 4 2s2-2 4-2c.5 0 1 .17 1.5.5"/><path d="M21 3c-4 0-8 1-10 4 2 1 4 3 4 7 2-1 4-2 6-5"/>',
  people:  '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  phone:   '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.4 9.82 19.79 19.79 0 01.36 1.18 2 2 0 012.34 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>',
  mail:    '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  pin:     '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
  clock:   '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  star:    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  check:   '<polyline points="20 6 9 17 4 12"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  dollar:  '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  heart:   '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>',
  paw:     '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="7.5" cy="3.5" r="0.5"/><path d="M9 10a5 5 0 016 0l2.5 3.5a3 3 0 01-2.5 4.5h-6a3 3 0 01-2.5-4.5L9 10z"/>',
  car:     '<path d="M5 17H3v-5l2-5h12l2 5v5h-2"/><path d="M5 12h14"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>',
  scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
};

function getIcon(name) {
  return ICONS[name] || null;
}

function iconSvg(name, wrapperClass) {
  const paths = getIcon(name);
  if (!paths) return '';
  return `<div class="${wrapperClass}"><svg viewBox="0 0 24 24">${paths}</svg></div>`;
}

module.exports = { getIcon, iconSvg, ICONS };
