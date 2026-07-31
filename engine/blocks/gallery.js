'use strict';

// gallery — a filterable album grid with a lightbox.
//
// THE "ALL" TAB HAS TWO MODES (`allShows`). The default, "albums", is the
// original behaviour: All shows every album card. It is also the only view that
// gets WORSE as a portfolio grows — it is the tab that loads first, so adding
// work dilutes the front door instead of improving it. Past a couple of
// categories that decay is structural, not a matter of taste.
//
// "categories" is the alternative: All shows ONE cover card per category, and
// the individual project cards live on the category tabs where the count is
// bounded and the lightbox makes sense. The mode is an explicit field rather
// than something inferred from the presence of covers, because inferring it
// would mean seeding one cover silently re-plumbs every visitor's first
// impression. A gallery that does not set it renders byte-identically to the
// pre-feature output.
//
// A COVER BELONGS TO THE FILTER, NOT TO AN ALBUM. The category is already
// defined exactly once — in `filters[]`, where `value` is its identity and
// `label` its display name. That list is a category list that happens to render
// as buttons, and hanging the cover off it says "this photo represents Garages"
// on the one row that already says "Garages". It also leaves the album object's
// shape completely untouched.
//
// ONE AFFORDANCE PER MEANING. A cover card and an album card would otherwise be
// two identical-looking cards that do different things — "switch the filter"
// vs. "open this project". They are not distinguished by styling alone here:
// a cover is a real <a> (it navigates to a real fragment; see main.js) and an
// album card stays role="button" (it acts on this page, opening the lightbox).
// Link vs. button is the platform's own encoding of that exact distinction, so
// the browser, the screen reader and the visitor all get it for free rather
// than having to infer it from a hover state. The cover's accessible name is
// its visible text — category label plus a DERIVED project count — following
// the same rule photo-strip and testimonials settled on: what you see is what
// is announced. The count is what honestly signals "there is more behind this",
// and because it is derived it can never drift from the albums.
const { esc, escAttr } = require('../lib/escape');

module.exports = function gallery(fields, site, bk) {
  const tag     = fields.tag     ? `<div class="section-tag"${bk.f('tag')}>${esc(fields.tag)}</div>` : '';
  const heading = fields.heading ? `<h2${bk.f('heading')}>${esc(fields.heading)}</h2>` : '';

  const filters = fields.filters || [];
  const albumList = fields.albums || [];

  // The tab button is where a filter's `label` renders in BOTH modes, so it is
  // the label's click-to-edit home; a cover card annotates the same field again
  // (annotations are a set — the same triple twice is one editable field with
  // two doorways, which is what an owner expects when the words appear twice).
  // `value` is deliberately not editable anywhere: it is the join key between a
  // filter and its albums, and renaming it silently orphans every album in the
  // category. It is refused by DEVELOPER_ONLY_FIELDS in patch.js, which closes
  // the write door and drops it from the edit map together.
  const filterBtns = filters.map((f, i) =>
    `<button class="filter-btn${i === 0 ? ' active' : ''}" data-filter="${escAttr(f.value)}"${bk.i(f.id, 'label')}>${esc(f.label)}</button>`
  ).join('\n      ');

  // Category covers. Emitted only in "categories" mode; main.js hides them
  // whenever the active filter is not "all".
  //
  // Two empty cases, both decided here rather than left to CSS:
  //   - a filter with no `cover` falls back to the first photo of its first
  //     album, so the mode works the moment it is switched on and choosing a
  //     nicer photo is an upgrade rather than a prerequisite. The fallback
  //     image is NOT an edit target — bk.i self-gates on the field existing, so
  //     an unseeded cover correctly renders un-annotated instead of becoming a
  //     dead click. Seed `cover` to make it editable (item fields are not
  //     owner-creatable; see BLOCK_CATALOG).
  //   - a filter with NO albums gets no card at all. Its card could only lead
  //     to "No projects match this filter", and a doorway to an empty room is
  //     worse than no doorway. build.js warns so the hole is visible.
  // The first filter is the "All" tab itself — the container, never a card.
  const coverCards = fields.allShows === 'categories'
    ? filters.slice(1).map(f => {
        const inCategory = albumList.filter(a => a.category === f.value);
        if (!inCategory.length) return '';
        const img = f.cover || inCategory[0].images[0];
        const count = `${inCategory.length} project${inCategory.length === 1 ? '' : 's'}`;
        // The href is the ONLY place the target category is written — main.js
        // reads it back off the fragment, so a second data-* copy would just be
        // a thing that can disagree. Percent-encoded because `value` is an
        // arbitrary string in the schema: a category like "Custom Homes" would
        // otherwise emit a malformed fragment that resolves to no filter and
        // silently falls back to the overview. main.js decodes to match.
        return `<a class="category-card fade-in" href="#category-${escAttr(encodeURIComponent(f.value))}">
        <span class="category-card-img"${bk.i(f.id, 'cover')}>
          <img src="${esc(img)}" alt="" loading="lazy">
        </span>
        <span class="category-card-body">
          <span class="category-name"${bk.i(f.id, 'label')}>${esc(f.label)}</span>
          <span class="category-count">${esc(count)}</span>
          <span class="category-cue-arrow" aria-hidden="true">→</span>
        </span>
      </a>`;
      }).filter(Boolean).join('\n      ')
    : '';
  // Carries its own leading newline/indent so that "albums" mode emits NOTHING
  // here — not even the blank line an empty interpolation would leave. The
  // pre-feature output stays byte-identical, which is what lets this ship
  // without re-reviewing every existing client's build.
  const coverGrid = coverCards
    ? `\n    <div class="category-grid">\n      ${coverCards}\n    </div>`
    : '';

  const albums = albumList.map(album => {
    const thumb  = album.images[0];
    const imgs   = album.images.map(i => escAttr(i)).join(',');
    const meta   = album.meta ? `<span class="album-meta"${bk.i(album.id, 'meta')}>${esc(album.meta)}</span>` : '';
    // An optional external link turns the album into a doorway to the full set
    // (a hosted Google/Facebook album, say): the local images stay an on-site
    // lightbox teaser, and this link leads to everything. Opens in a new tab so
    // the site stays put; main.js stops its click from also tripping the
    // lightbox. The URL and the label are independent click-to-edit targets —
    // the href rides the anchor (clicking the arrow edits where it goes), the
    // optional linkLabel rides its own span (clicking the words edits them); an
    // owner can repoint the link if the host changes. `linkLabel` falls back to
    // a default when unset, and bk.i self-gates so it's only an edit target once
    // the field exists. Without an href the card behaves exactly as before.
    const linkText = album.linkLabel != null ? album.linkLabel : 'See all photos';
    const link   = album.href
      ? `<a class="album-link" href="${escAttr(album.href)}" target="_blank" rel="noopener"${bk.i(album.id, 'href')}><span class="album-link-text"${bk.i(album.id, 'linkLabel')}>${esc(linkText)}</span> <span class="album-link-arrow" aria-hidden="true">→</span></a>`
      : '';
    return `<div class="album-card fade-in"
        data-type="${escAttr(album.category)}"
        data-images="${imgs}"
        data-title="${escAttr(album.title)}"
        tabindex="0" role="button" aria-label="View ${escAttr(album.title)} gallery">
        <div class="album-card-img"${bk.i(album.id, 'images')}>
          <img src="${esc(thumb)}" alt="${esc(album.title)}" loading="lazy">
        </div>
        <div class="album-card-body">
          <span class="album-tag"${bk.i(album.id, 'category')}>${esc(album.category)}</span>
          <h3${bk.i(album.id, 'title')}>${esc(album.title)}</h3>
          ${meta}
          ${link}
        </div>
      </div>`;
  }).join('\n      ');

  return `<section class="gallery">
  <div class="container">
    ${tag}
    ${heading}
    <div class="filter-bar">
      ${filterBtns}
    </div>${coverGrid}
    <div class="album-grid">
      ${albums}
    </div>
    <div class="gallery-empty" id="gallery-empty" hidden>No projects match this filter.</div>
  </div>
</section>`;
};
