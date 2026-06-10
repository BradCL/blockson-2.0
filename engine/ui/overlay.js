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

  // Hover/selection styles for annotated elements.
  var style = document.createElement('style');
  style.textContent =
    '[data-bk-block]{cursor:pointer}' +
    '.bk-hover{outline:2px solid #2563eb !important;outline-offset:2px;border-radius:2px;' +
    'background-color:rgba(37,99,235,.08) !important;transition:background-color .1s}';
  document.head.appendChild(style);

  var hovered = null;
  function clearHover() {
    if (hovered) { hovered.classList.remove('bk-hover'); hovered = null; }
  }

  document.addEventListener('mouseover', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-bk-block]') : null;
    if (el === hovered) return;
    clearHover();
    if (el) { hovered = el; el.classList.add('bk-hover'); }
  }, true);

  document.addEventListener('mouseleave', clearHover, true);

  // Capture-phase click: editing wins over the page's own handlers
  // (nav links, gallery lightbox, accordion toggles).
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-bk-block]') : null;
    if (!el) return; // unannotated links (e.g. nav) keep navigating inside the preview
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

  // Tell the editor app which page is showing, so a rebuild can reload
  // the same page.
  window.parent.postMessage({ type: 'bk-nav', path: window.location.pathname }, ORIGIN);
})();
