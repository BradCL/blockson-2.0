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
    'box-shadow:0 0 0 4px rgba(37,99,235,.25) !important;transition:box-shadow .1s}' +
    '[data-bk-hidden]{opacity:.45;outline:2px dashed #b45309;outline-offset:-2px;position:relative;cursor:pointer}' +
    '[data-bk-hidden]::before{content:"Hidden section \\2014  visitors don\\2019t see this. Click anywhere in it to show it again.";' +
    'display:block;position:absolute;top:0;left:0;right:0;z-index:50;' +
    'background:#b45309;color:#fff;font:13px/1.6 system-ui,sans-serif;' +
    'text-align:center;padding:2px 8px;opacity:1}';
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

  function setMode(m) {
    mode = (m === 'preview') ? 'preview' : 'edit';
    clearHover();
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
    var el = e.target && e.target.closest ? e.target.closest('[data-bk-block]') : null;
    if (el === hovered) return;
    clearHover();
    if (el) { hovered = el; el.classList.add('bk-hover'); }
  }, true);

  document.addEventListener('mouseleave', clearHover, true);

  // Capture-phase click: in EDIT mode editing wins over the page's own
  // handlers (nav links, gallery lightbox, accordion toggles). In PREVIEW
  // mode the handler is inert, so every native behaviour runs untouched.
  document.addEventListener('click', function (e) {
    if (mode !== 'edit') return; // preview: let the page behave like the live site
    var el = e.target && e.target.closest ? e.target.closest('[data-bk-block]') : null;
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
