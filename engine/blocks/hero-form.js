'use strict';

// hero-form — a hero whose call to action IS the form, rather than a button that
// asks the visitor to navigate before they can act. Copy on one side, a short
// lead form on the other, above the fold: the layout ad traffic lands on.
//
// A DISTINCT block type rather than an option on `hero`, for two reasons. SPEC
// §2.6 ("adding a block must never require changing existing blocks") — `hero`
// is in every client, and this leaves it and heroFields untouched. And the
// two-column layout lives inside this block's own markup, the way
// service-area's does, so nothing is needed from lib/render.js (which emits
// blocks as flat siblings) or partials/head.js (which only emits tokens into
// :root) — the two seams where a change would ripple across every page.
//
// The form is rendered by lib/formfields.js, shared with contact-form, so both
// share one escaping path, one honeypot, one delivery contract and one origin
// tag. `.hero`/`.hero-bg`/`.hero-content` are reused deliberately: the photo,
// overlay, texture layer and owner-editable overlay opacity all come along, and
// .hero-form only overrides what differs.
const { esc } = require('../lib/escape');
const { renderForm } = require('../lib/formfields');

module.exports = function heroForm(fields, site, bk) {
  const form = (fields.form && typeof fields.form === 'object') ? fields.form : {};

  // Owner-editable focal point + zoom, identical in shape and guard to the
  // hero's (patch.js FIELD_FORMATS is keyed on the leaf name, so the same guard
  // fires here, and owner.js gates its focal controls on the `background` field
  // rather than the block type — both work with no change). esc() stays as the
  // last line of defence for an inline style.
  const bgPosition = typeof fields.bgPosition === 'string' && fields.bgPosition ? fields.bgPosition : '50% 50%';
  const bgZoom = typeof fields.bgZoom === 'number' ? fields.bgZoom : 1;
  const bgStyle = `background-image:url('${esc(fields.background)}')`
    + `;background-position:${esc(bgPosition)}`
    + `;transform:scale(${esc(String(bgZoom))});transform-origin:${esc(bgPosition)}`;

  // Which side the form sits on, desktop only — the narrow layout always stacks
  // copy first (see the stylesheet). Absent → copy-left, so a client that never
  // sets it gets the reading order that suits cold ad traffic.
  const formLeft  = fields.variant === 'form-left';
  const innerCls  = formLeft ? 'hero-form-inner form-left' : 'hero-form-inner';

  const formHeading = form.heading
    ? `<h2 class="hero-form-heading"${bk.f('form.heading')}>${esc(form.heading)}</h2>\n        ` : '';

  return `<section class="hero hero-form">
  <div class="hero-bg"${bk.bg('background')} style="${bgStyle}"></div>
  <div class="container">
    <div class="${innerCls}"${bk.f('variant')}>
      <div class="hero-content">
        <div class="hero-tag"${bk.f('tag')}>${esc(fields.tag)}</div>
        <h1${bk.f('headline')}>${esc(fields.headline)}</h1>
        <p${bk.f('subhead')}>${esc(fields.subhead)}</p>
      </div>
      <div class="hero-form-panel">
        ${formHeading}${renderForm(form, bk, {
          className: 'contact-form hero-lead-form', prefix: 'form.', indent: 10,
        })}
      </div>
    </div>
  </div>
</section>`;
};
