/* ============================================================
   themes/default/js/main.js — shared behaviour for ALL themes

   NOTE ON PROVENANCE: the original production main.js was not
   included in the regeneration context (theme assets were excluded
   from the bundle), so this is a complete re-implementation of its
   documented behaviour: nav toggle, fade-in observer, gallery
   filter, and lightbox driven by the album-card data-* attributes
   exactly as gallery.js emits them. No frameworks, no globals
   leaked, no external requests.
   ============================================================ */
(function () {
  'use strict';

  /* ── Nav toggle ─────────────────────────────────────────── */
  var toggle = document.querySelector('.nav-toggle');
  var links  = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ── Fade-in on scroll ──────────────────────────────────── */
  var faders = document.querySelectorAll('.fade-in');
  if ('IntersectionObserver' in window && faders.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    faders.forEach(function (el) { io.observe(el); });
  } else {
    faders.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ── Gallery filter ─────────────────────────────────────── */
  var filterBtns = document.querySelectorAll('.filter-btn');
  var albumCards = document.querySelectorAll('.album-card');
  var emptyMsg   = document.getElementById('gallery-empty');
  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var f = btn.getAttribute('data-filter');
      var visible = 0;
      albumCards.forEach(function (card) {
        var show = f === 'all' || card.getAttribute('data-type') === f;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      if (emptyMsg) emptyMsg.hidden = visible !== 0;
    });
  });

  /* ── Lightbox ───────────────────────────────────────────── */
  function openLightbox(images, title) {
    var idx = 0;
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', title + ' photo viewer');
    box.innerHTML =
      '<button class="lightbox-close" aria-label="Close">&times;</button>' +
      (images.length > 1
        ? '<button class="lightbox-prev" aria-label="Previous photo">&#8249;</button>' +
          '<button class="lightbox-next" aria-label="Next photo">&#8250;</button>'
        : '') +
      '<img class="lightbox-img" alt="">' +
      '<div class="lightbox-caption"></div>' +
      '<div class="lightbox-count"></div>';
    document.body.appendChild(box);

    var img     = box.querySelector('.lightbox-img');
    var caption = box.querySelector('.lightbox-caption');
    var count   = box.querySelector('.lightbox-count');

    function render() {
      img.src = images[idx];
      img.alt = title + ' — photo ' + (idx + 1);
      caption.textContent = title;
      count.textContent = images.length > 1 ? (idx + 1) + ' / ' + images.length : '';
    }
    function close() {
      document.body.removeChild(box);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') { idx = (idx + 1) % images.length; render(); }
      if (e.key === 'ArrowLeft')  { idx = (idx - 1 + images.length) % images.length; render(); }
    }

    box.querySelector('.lightbox-close').addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    var prev = box.querySelector('.lightbox-prev');
    var next = box.querySelector('.lightbox-next');
    if (prev) prev.addEventListener('click', function () { idx = (idx - 1 + images.length) % images.length; render(); });
    if (next) next.addEventListener('click', function () { idx = (idx + 1) % images.length; render(); });
    document.addEventListener('keydown', onKey);
    render();
  }

  albumCards.forEach(function (card) {
    function activate() {
      var images = (card.getAttribute('data-images') || '').split(',').filter(Boolean);
      var title  = card.getAttribute('data-title') || '';
      if (images.length) openLightbox(images, title);
    }
    card.addEventListener('click', activate);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });
})();
