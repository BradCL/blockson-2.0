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

  /* ── Nav submenu: Escape closes ─────────────────────────────
     Pure enhancement. The submenu itself is CSS (:hover / :focus-within), so
     with JS off it still opens, still closes, and is still keyboard-reachable.
     What CSS cannot express is "I'm done with this menu but I want to stay on
     the parent link", because focus-within keeps it open — that is all this
     does. The flag clears the moment focus or the pointer leaves. */
  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      item.classList.add('nav-item--closed');
      var parentLink = item.querySelector('a');
      if (parentLink) parentLink.focus();
    });
    item.addEventListener('focusout', function (e) {
      if (!item.contains(e.relatedTarget)) item.classList.remove('nav-item--closed');
    });
    item.addEventListener('mouseleave', function () {
      item.classList.remove('nav-item--closed');
    });
  });

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

  /* ── Gallery filter ─────────────────────────────────────────
     The active category lives in the URL fragment (#category-garages), and
     THAT is the single source of truth: buttons and category covers alike do
     nothing but set the hash, and one hashchange handler does the filtering.
     One code path, and the back button works without touching the History API.

     Why the fragment at all. Three things fall out of it that the old
     click-handler-only filter could not do: a category is linkable (an ad or a
     campaign can land straight on it), it is shareable (a visitor can send
     someone "our garages"), and the back button behaves — previously, entering
     the gallery and filtering left Back pointing at the page you arrived from,
     silently discarding the filtering you had done. It is also what lets a
     category cover be an honest <a>: the destination exists.

     HISTORY: PUSH, DELIBERATELY. Assigning location.hash pushes a history
     entry, so this is what you get by writing no code at all — but it is a
     choice with a real cost, not a freebie. Five filter clicks means five Back
     presses to leave the gallery. history.replaceState would make Back always
     exit the page in one press, at the cost of making the filter un-undoable.
     Push wins HERE because browsing a gallery is exploratory: a visitor who
     clicked into Garages from a cover card treats that as having gone
     somewhere, and expects Back to return to the overview rather than to
     whatever page preceded the gallery. Undoing a step you took on purpose is
     worth more than a cheap exit. Revisit this if filters ever land on a page
     where the filtering is incidental rather than the point of the visit.

     Anything that is not a #category- fragment is ignored outright, so ordinary
     in-page anchors elsewhere on the site never disturb a gallery. */
  var HASH_PREFIX = 'category-';
  var filterBtns  = document.querySelectorAll('.filter-btn');
  var albumCards  = document.querySelectorAll('.album-card');
  var emptyMsg    = document.getElementById('gallery-empty');
  var filterBar   = document.querySelector('.filter-bar');
  var coverGrid   = document.querySelector('.category-grid');

  if (filterBtns.length) {
    // The first tab is the "show everything" tab by convention (its value is
    // "all"); read it rather than hard-coding, so a client that renames it does
    // not lose its default view.
    var defaultFilter = filterBtns[0].getAttribute('data-filter');

    // Which category the URL is asking for — or the default when the fragment
    // is absent, belongs to something else, or names a tab this gallery has no
    // button for (a stale link after a category was retired should land on the
    // overview, not on a blank grid).
    function filterFromHash() {
      var h = (window.location.hash || '').replace(/^#/, '');
      if (h.indexOf(HASH_PREFIX) !== 0) return defaultFilter;
      // The renderer percent-encodes the category (a `value` may be any string,
      // e.g. "Custom Homes"), so decode before matching. A hand-mangled
      // fragment can be malformed enough to throw — fall back rather than let
      // one bad link break the whole page's scripting.
      var want = h.slice(HASH_PREFIX.length);
      try { want = decodeURIComponent(want); } catch (e) { return defaultFilter; }
      var known = false;
      filterBtns.forEach(function (b) { if (b.getAttribute('data-filter') === want) known = true; });
      return known ? want : defaultFilter;
    }

    function applyFilter(f) {
      filterBtns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-filter') === f);
      });

      // On the overview tab of a categories-mode gallery the album cards stay
      // hidden: the covers ARE that tab. Everywhere else the covers go away and
      // the albums filter exactly as they always have.
      var overview = f === defaultFilter;
      if (coverGrid) coverGrid.hidden = !overview;

      var visible = 0;
      albumCards.forEach(function (card) {
        var show = (overview && !coverGrid) || (!overview && card.getAttribute('data-type') === f);
        // A card revealed later is still observed by the fade-in observer
        // above (it only unobserves cards it has already shown), so it fades in
        // on reveal instead of arriving stuck at opacity 0.
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      // "Nothing here" is only meaningful on a category tab. The overview of a
      // categories-mode gallery legitimately shows no album cards at all.
      if (emptyMsg) emptyMsg.hidden = visible !== 0 || (overview && !!coverGrid);
    }

    function syncFromHash(scroll) {
      applyFilter(filterFromHash());
      // A deep link — or a cover click from the top of a long page — must land
      // ON the gallery, not at whatever scroll position the browser kept. Only
      // scroll when the filter bar is actually out of view, so clicking a tab
      // that is already on screen never yanks the page.
      if (!scroll || !filterBar) return;
      var box = filterBar.getBoundingClientRect();
      if (box.top < 0 || box.bottom > (window.innerHeight || 0)) {
        filterBar.scrollIntoView({ block: 'start' });
      }
    }

    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Setting the hash is the whole handler: the hashchange listener below
        // does the work, so a tab click and a cover click and a pasted link all
        // travel the identical path.
        window.location.hash = HASH_PREFIX + encodeURIComponent(btn.getAttribute('data-filter'));
        // Clicking the tab you are already on fires no hashchange — apply
        // anyway so the first click on a fresh page (no fragment yet, default
        // tab) is not a no-op.
        syncFromHash(false);
      });
    });
    window.addEventListener('hashchange', function () { syncFromHash(true); });
    syncFromHash(window.location.hash.indexOf('#' + HASH_PREFIX) === 0);
  }

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

  // An album's optional "See all photos" link is a real anchor inside the
  // card: let it navigate, but stop the click from bubbling to the card and
  // also opening the lightbox.
  document.querySelectorAll('.album-link').forEach(function (a) {
    a.addEventListener('click', function (e) { e.stopPropagation(); });
  });

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
