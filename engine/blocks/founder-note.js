'use strict';

// founder-note — one person's story beside their portrait: the "about the
// founder" section an owner-led business puts on its About page. Trades, solo
// operators, professional services — the place a small business says who is
// actually behind the work, in several paragraphs rather than a caption.
//
// A DISTINCT block type rather than an option on `team-grid`, and not a stack
// of `team-grid` + `text`:
//   - team-grid is a ROSTER. Its `bio` is one string rendered as one <p>, so
//     multi-paragraph prose cannot go in it, and `.team-grid` is
//     repeat(auto-fit, minmax(220px, 1fr)) — a single member stretches to the
//     full width as a wide centred card with a circular 120px photo. That is a
//     team section with one person in it, which is a different claim.
//   - stacking team-grid + text gives the owner TWO disconnected edit surfaces
//     for what is conceptually one section.
// Per SPEC §2.6, adding a block must never require changing existing blocks:
// team-grid and teamGridFields are untouched by this.
//
// Blocks render as flat siblings into <body> (lib/render.js), so the
// portrait-beside-prose layout has to live inside this block's own markup —
// the same way service-area's and hero-form's two-column layouts do. Nothing
// is needed from render.js or partials/head.js.
//
// A PORTRAIT IS VERTICAL. The stylesheet gives it a 3:4 box and never a circle
// or a landscape crop; that shape is most of why team-grid cannot carry this
// section, so it is the one thing the block exists to get right.
//
// UGLY, NEVER BROKEN: a missing portrait degrades exactly the way team-grid's
// does — a neutral initial block in the same 3:4 frame, never a broken <img>.
// `role`, `quote` and `signature` are each optional and each render nothing
// when absent; all three are CREATABLE (patch.js CREATABLE_FIELDS), so taking
// one out is not a one-way door back to a developer errand.
const { esc } = require('../lib/escape');

module.exports = function founderNote(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';
  // The section header sits ABOVE both columns, so a narrow screen reads
  // heading → face → story rather than repeating the heading per column.
  const header  = (tag || heading)
    ? `<div class="section-header">
      ${tag}
      ${heading}
    </div>
    ` : '';

  // The portrait is the block's one image target, reached by the image picker
  // through the annotation on its wrapper (owner.js decides image-ness from the
  // VALUE's path shape, not the field name, so `portrait` needs nothing special).
  // The empty state is aria-hidden and carries no annotation: there is no
  // portrait to edit yet, and an unannotated placeholder is what keeps proof 1's
  // required-annotation set honest.
  const portrait = fields.portrait
    ? `<div class="founder-portrait"${bk.f('portrait')}><img src="${esc(fields.portrait)}" alt="${esc(fields.name)}" loading="lazy"></div>`
    : `<div class="founder-portrait founder-portrait-empty" aria-hidden="true"><span>${esc(String(fields.name || '?').charAt(0))}</span></div>`;

  const role = fields.role
    ? `<div class="founder-role"${bk.f('role')}>${esc(fields.role)}</div>` : '';

  const paras = (fields.body || []).map((p, i) => `<p${bk.l('body', i)}>${esc(p)}</p>`).join('\n        ');

  // The pull quote and the signature are their OWN fields, not the last two
  // paragraphs of `body`. Three reasons, and they are why the shape is worth a
  // field each: they render in different registers (a quote is set large against
  // a rule; a signature is a small italic sign-off), which a renderer cannot
  // infer from position; each becomes a stable, separately-addressable edit
  // target ("the signature") instead of an index-fragile "last line of body";
  // and each can be dropped independently without disturbing the prose.
  const quote = fields.quote
    ? `<blockquote class="founder-quote"${bk.f('quote')}>${esc(fields.quote)}</blockquote>` : '';
  const signature = fields.signature
    ? `<div class="founder-signature"${bk.f('signature')}>${esc(fields.signature)}</div>` : '';

  // Which side the portrait sits on, desktop only — the narrow layout always
  // stacks the portrait first (see the stylesheet). This is developer-tier
  // layout config carried as a `variant`, exactly like hero-form's: it is a
  // decision about the page's composition, not about what the section says.
  // Absent → portrait-left, so a client that never sets it gets the ordinary
  // Western reading order (face, then story).
  const inner = fields.variant === 'portrait-right'
    ? 'founder-note-inner portrait-right' : 'founder-note-inner';

  return `<section class="founder-note fade-in">
  <div class="container">
    ${header}<div class="${inner}"${bk.f('variant')}>
      <div class="founder-aside">
        ${portrait}
        <div class="founder-identity">
          <h3 class="founder-name"${bk.f('name')}>${esc(fields.name)}</h3>
          ${role}
        </div>
      </div>
      <div class="founder-body">
        ${paras}
        ${quote}
        ${signature}
      </div>
    </div>
  </div>
</section>`;
};
