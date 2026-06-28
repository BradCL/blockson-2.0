/* ============================================================
   engine/ui/overlay.js — Click-to-edit overlay (v4, Task 2)

   Injected AT SERVE TIME by engine/serve.js into pages of the
   annotated candidate build only (it is never part of any build on
   disk, and live builds are never served through /preview at all).

   It does two things:
   - highlights the innermost element carrying data-bk-* attributes as
     the owner hovers, and
   - on click, suppresses the page's own behaviour (links, lightboxes)
     and posts the element's (block, item?, field, index?) reference to
     the parent editor app via postMessage.

   Everything is built with DOM APIs — no markup is assembled from
   page content, so annotated values can never inject into this layer.
   ============================================================ */
'use strict';
(function () {
  var ORIGIN = window.location.origin;

  // ── MODE ──────────────────────────────────────────────────────
  // EDIT (default): the overlay is active — hover-highlight, click-to-edit,
  //   and the dimmed/badged treatment of hidden sections.
  // PREVIEW: the overlay is fully inert and its injected <style> is removed,
  //   so the page behaves exactly as a visitor's would (links navigate,
  //   gallery lightbox and accordions work) and looks like the live site;
  //   hidden sections are simulated-live (display:none). The mode is driven
  //   from the editor chrome (ui.js) over postMessage; nothing here is ever
  //   written to disk, so neither mode can affect any build.
  var mode = 'edit';

  // EDIT-mode styling: hover ring + the dimmed/badged HIDDEN sections
  // (data-bk-hidden, stamped only in annotated preview builds — this CSS
  // lives in the editor layer and is never part of any live output). A
  // hidden section stays visible and CLICKABLE here so the owner can always
  // reach the toggle that unhides it (cursor:pointer advertises that, and the
  // click handler below resolves a click anywhere inside it to the block).
  var editStyle = document.createElement('style');
  editStyle.textContent =
    '[data-bk-block]{cursor:pointer}' +
    // Indicate hover with an OUTLINE plus a soft box-shadow ring — never a
    // background-color override. A background override (the old rule) won
    // the cascade over solid-fill elements (.btn-primary), erasing their
    // own paint and hiding their text on dark themes. Outline + ring stay
    // clearly visible on text, images, and containers while leaving every
    // element's own background untouched.
    '.bk-hover{outline:2px solid #2563eb !important;outline-offset:2px;border-radius:2px;' +
    'cursor:pointer;box-shadow:0 0 0 4px rgba(37,99,235,.25) !important;transition:box-shadow .1s}' +
    '[data-bk-hidden]{opacity:.45;outline:2px dashed #b45309;outline-offset:-2px;position:relative;cursor:pointer}' +
    '[data-bk-hidden]::before{content:"Hidden section \\2014  visitors don\\2019t see this. Click anywhere in it to show it again.";' +
    'display:block;position:absolute;top:0;left:0;right:0;z-index:50;' +
    'background:#b45309;color:#fff;font:13px/1.6 system-ui,sans-serif;' +
    'text-align:center;padding:2px 8px;opacity:1}' +
    // The per-section doorway chip: a single hover-revealed affordance (see
    // below). position:fixed so a section's overflow:hidden can't clip it.
    '.bk-section-chip{position:fixed;z-index:2147483646;background:#2563eb;color:#fff;' +
    'border:none;border-radius:4px;font:13px/1 system-ui,sans-serif;padding:6px 10px;' +
    'cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35)}' +
    '.bk-section-chip:hover{background:#1d4ed8}';
  document.head.appendChild(editStyle);

  // PREVIEW-mode styling: simulate the live site by dropping hidden sections
  // entirely (live builds omit them; the annotated preview keeps them only so
  // the owner can unhide them). Appended only while in preview mode.
  var previewStyle = document.createElement('style');
  previewStyle.textContent = '[data-bk-hidden]{display:none !important}';

  var hovered = null;
  function clearHover() {
    if (hovered) { hovered.classList.remove('bk-hover'); hovered = null; }
  }

  // ── Section chip (the per-section doorway) ────────────────────
  // A single hover-revealed affordance that opens the editor's Section panel —
  // background, style, visibility, and "add what this section doesn't have
  // yet" (e.g. a subtitle), none of which depends on a particular element
  // being rendered. It lives in document.body (position:fixed) so a section's
  // overflow:hidden can't clip it, the same reason the hover ring rings the
  // section rather than its behind-content background. The chip is resolved
  // from the existing data-bk-bg marker (always present on a hero/page-header
  // in the annotated preview): its parent is the section, and the marker
  // carries the block id. EDIT-mode only and overlay-injected — never in any
  // build, and a live page has no data-bk-bg, so it never resolves a section.
  var chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'bk-section-chip';
  chip.textContent = 'Edit section ▾';
  chip.style.display = 'none';
  document.body.appendChild(chip);
  var chipBlock = null;

  function hideChip() { chip.style.display = 'none'; chipBlock = null; }

  function showChipFor(section, blockId) {
    var r = section.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { hideChip(); return; }
    chipBlock = blockId;
    chip.style.display = 'block';
    chip.style.top = Math.max(8, r.top + 8) + 'px';
    chip.style.right = Math.max(8, window.innerWidth - r.right + 8) + 'px';
  }

  chip.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (chipBlock) window.parent.postMessage({ type: 'bk-section', block: chipBlock }, ORIGIN);
  });
  // A stale fixed-position chip after scrolling would float over the wrong
  // place; drop it and let the next hover re-resolve it.
  window.addEventListener('scroll', hideChip, true);

  // ── Target resolution ─────────────────────────────────────────
  // Normally the edit target is the innermost ancestor carrying data-bk-*
  // (`closest`). But a SECTION BACKGROUND (hero / page-header) is painted
  // behind the section content with a negative z-index, so it is never the
  // event target and `closest` never reaches it: a dead-space click resolves
  // to nothing (hero, whose <section> carries no field of its own) or to the
  // section's own field such as variant (page-header) — and the background,
  // plus the hero focal/zoom controls that open from it, can't be reached.
  //
  // The annotated build marks each such background with data-bk-bg as a direct
  // child of its section. So walk up from the pointer to the nearest ancestor
  // that owns a background child; if the click did NOT land on a more specific
  // annotated element inside that section (it hit nothing, or only the section
  // root), resolve to the background. The marker exists in the annotated
  // preview only, so none of this can affect a live build.
  function sectionBackground(node) {
    while (node && node.nodeType === 1) {
      var kids = node.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].hasAttribute && kids[i].hasAttribute('data-bk-bg')) {
          return { section: node, bg: kids[i] };
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function resolveTarget(target) {
    if (!target || !target.closest) return null;
    var specific = target.closest('[data-bk-block]');
    var found = sectionBackground(target);
    if (found && (!specific || specific === found.section)) return found.bg;
    return specific;
  }

  function setMode(m) {
    mode = (m === 'preview') ? 'preview' : 'edit';
    clearHover();
    hideChip();
    if (mode === 'preview') {
      if (editStyle.parentNode) editStyle.parentNode.removeChild(editStyle);
      if (!previewStyle.parentNode) document.head.appendChild(previewStyle);
    } else {
      if (!editStyle.parentNode) document.head.appendChild(editStyle);
      if (previewStyle.parentNode) previewStyle.parentNode.removeChild(previewStyle);
    }
  }

  document.addEventListener('mouseover', function (e) {
    if (mode !== 'edit') return;
    // Keep the chip up while the pointer is on it (it sits above the section).
    if (e.target === chip) return;
    // Reveal the chip for the section under the pointer (a hero/page-header,
    // identified by its data-bk-bg child); hide it anywhere else.
    var sec = sectionBackground(e.target);
    if (sec) showChipFor(sec.section, sec.bg.dataset.bkBlock);
    else hideChip();
    var el = resolveTarget(e.target);
    // For a behind-content background, ring the SECTION (its parent) instead:
    // the background's own outline would be clipped by the section's
    // overflow:hidden, and ringing the section shows the whole editable area.
    var ring = (el && el.hasAttribute('data-bk-bg')) ? el.parentNode : el;
    if (ring === hovered) return;
    clearHover();
    if (ring) { hovered = ring; ring.classList.add('bk-hover'); }
  }, true);

  document.addEventListener('mouseleave', clearHover, true);

  // Capture-phase click: in EDIT mode editing wins over the page's own
  // handlers (nav links, gallery lightbox, accordion toggles). In PREVIEW
  // mode the handler is inert, so every native behaviour runs untouched.
  document.addEventListener('click', function (e) {
    if (mode !== 'edit') return; // preview: let the page behave like the live site
    var el = resolveTarget(e.target);
    if (!el) {
      // A click in a HIDDEN section's dead space or on its badge lands here
      // (the section root carries data-bk-hidden but no data-bk-block of its
      // own). Resolve it to the section's first editable element so the editor
      // opens with the "Show this section again" toggle — the owner never
      // needs "Discard all" to escape a section they just hid.
      var hiddenEl = e.target && e.target.closest ? e.target.closest('[data-bk-hidden]') : null;
      if (hiddenEl) el = hiddenEl.querySelector('[data-bk-block]');
      if (!el) return; // otherwise unannotated (e.g. nav) keeps navigating inside the preview
    }
    e.preventDefault();
    e.stopPropagation();
    var d = el.dataset;
    window.parent.postMessage({
      type: 'bk-edit',
      block: d.bkBlock,
      item: d.bkItem !== undefined ? d.bkItem : null,
      field: d.bkField,
      index: d.bkIndex !== undefined ? d.bkIndex : null,
    }, ORIGIN);
  }, true);

  // The editor chrome drives the mode; honour it the moment it arrives, and
  // again whenever this page (re)loads (ui.js re-posts it on every iframe load).
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'bk-mode') setMode(e.data.mode);
  });

  // Tell the editor app which page is showing, so a rebuild can reload
  // the same page.
  window.parent.postMessage({ type: 'bk-nav', path: window.location.pathname }, ORIGIN);
})();
