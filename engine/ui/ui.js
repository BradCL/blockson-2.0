/* ============================================================
   engine/ui/ui.js — Owner editor app (v4, Task 2)

   Talks to the local server's /api endpoints, listens for clicks
   relayed from the preview overlay, and renders the matching editor.
   Every patch is constructed deterministically from the clicked
   element's reference plus the field's CURRENT value as reported by
   the server (match-form list edits use the exact current line).

   XSS posture: every value is rendered with textContent / DOM APIs.
   No HTML string is ever assembled from site content.
   ============================================================ */
'use strict';

(function () {
  var state = null;            // last /api/state payload
  var currentPath = '/preview/index.html';
  var tokenCheckTimer = null;
  // When a field/token editor is open, `reopen` re-opens that SAME editor
  // fresh. It lets a save keep the editor in place: stage() no longer closes
  // it, renderPending() shows the Now→After review INSIDE the editor, and a
  // Keep/Discard re-opens it via reopen() so the owner never loses their place
  // (the one-pending-change rule is unchanged — they still keep between edits).
  // Cleared by closeEditor(), so one-shot flows (scaffold, remove, page reload
  // with a pending change) fall back to the standalone pending card.
  var reopen = null;

  var $ = function (id) { return document.getElementById(id); };
  var iframe = $('preview');

  // Friendly names for section settings / addable fields (Section panel).
  var FIELD_LABELS = {
    subhead: 'subtitle',
    variant: 'style',
    background: 'background',
  };
  function fieldLabel(f) { return FIELD_LABELS[f] || f; }
  function sectionTypeLabel(t) {
    return t === 'hero' ? 'hero' : t === 'page-header' ? 'page header' : t;
  }

  // Friendly labels for the safe-token allowlist.
  var TOKEN_LABELS = {
    '--color-primary': 'Brand color',
    '--color-accent': 'Accent color',
    '--btn-primary-bg': 'Button color',
    '--nav-bg': 'Menu bar background',
    '--footer-bg': 'Footer background',
    '--hero-overlay-opacity': 'Photo overlay darkness',
  };

  // ── Server I/O ───────────────────────────────────────────────
  function apiGet(path) {
    return fetch(path).then(function (r) { return r.json(); });
  }
  function apiPost(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-blockson-ui': '1' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  // ── Small DOM helpers (textContent only — never innerHTML) ──
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function button(label, className, onClick) {
    var b = el('button', 'btn' + (className ? ' ' + className : ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function showMessage(kind, text) {
    var m = $('message');
    m.className = 'message ' + kind;
    m.textContent = text;
    m.hidden = false;
  }
  function clearMessage() { $('message').hidden = true; }

  function reloadPreview() {
    iframe.src = currentPath + (currentPath.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  }

  // ── State rendering ──────────────────────────────────────────
  function refreshState() {
    return apiGet('/api/state').then(function (s) {
      state = s;
      $('client-name').textContent = s.clientName;
      renderSession();
      renderPending();
      renderTokens();
      $('publish-status').textContent = s.lastPublish ? s.lastPublish.message : '';
      var contact = $('contact-line');
      if (s.contact && (s.contact.name || s.contact.email)) {
        contact.textContent = 'Need a bigger change? Contact ' +
          (s.contact.name || '') + (s.contact.email ? ' — ' + s.contact.email : '');
      } else {
        contact.textContent = 'Need a bigger change (new pages, new sections)? Contact your developer.';
      }
    });
  }

  function diffValue(node, v) {
    if (v === null || v === undefined || v === '') {
      node.classList.add('empty');
      node.textContent = '(nothing)';
    } else {
      node.classList.remove('empty');
      node.textContent = String(v);
    }
  }

  function renderPending() {
    var cardEl = $('pending-card');
    if (!state.pending) { cardEl.hidden = true; return; }
    // An editor is open (a save just staged from it): keep it in place and show
    // the review inside it. Otherwise (one-shot flow, or a reload with a pending
    // change already present) show the standalone pending card.
    if (reopen) {
      cardEl.hidden = true;
      renderInlinePending();
      return;
    }
    closeEditor();
    $('pending-summary').textContent = state.pending.summary;
    diffValue($('pending-old'), state.pending.old);
    diffValue($('pending-new'), state.pending.new);
    cardEl.hidden = false;
  }

  // The pending review shown INSIDE the editor after a save, so the editor
  // never vanishes. Mirrors the standalone #pending-card markup; Keep/Discard
  // act through the same /api endpoints, then re-open the editor via reopen()
  // so the owner continues in place (e.g. set the hero image, keep, then adjust
  // focus and zoom without re-finding the editor each time).
  function renderInlinePending() {
    var ed = editorShell('Review your change');
    ed.appendChild(el('p', 'pending-summary', state.pending.summary));
    var diff = el('div', 'diff');
    var oldRow = el('div', 'diff-row');
    oldRow.appendChild(el('span', 'diff-label', 'Now'));
    diffValue(oldRow.appendChild(el('span', 'diff-value old')), state.pending.old);
    var newRow = el('div', 'diff-row');
    newRow.appendChild(el('span', 'diff-label', 'After'));
    diffValue(newRow.appendChild(el('span', 'diff-value new')), state.pending.new);
    diff.appendChild(oldRow);
    diff.appendChild(newRow);
    ed.appendChild(diff);

    var row = el('div', 'btn-row');
    row.appendChild(button('Keep', 'primary', inlineKeep));
    row.appendChild(button('Discard', null, inlineDiscard));
    ed.appendChild(row);
    ed.appendChild(el('p', 'hint',
      'Keep adds this to the session and returns to the editor for your next change — nothing goes live until you publish.'));
  }

  // Keep the inline pending change, then re-open the same editor fresh so the
  // owner can make the next edit in place. No preview reload: keeping does not
  // change the candidate (it was already built when the change was staged).
  function inlineKeep() {
    var go = reopen;
    apiPost('/api/keep').then(function (r) {
      if (!r.ok) { editorError($('editor'), r.error); return; }
      showMessage('info', 'Change kept — it goes live when you publish this session.');
      refreshState().then(function () { if (go) go(); });
    });
  }

  // Discard the inline pending change (the candidate rebuilds back, so reload
  // the preview), then re-open the same editor so the owner can try again.
  function inlineDiscard() {
    var go = reopen;
    apiPost('/api/discard').then(function (r) {
      if (!r.ok) { editorError($('editor'), r.error); return; }
      showMessage('info', 'Pending change discarded — anything you kept is still staged.');
      refreshState().then(function () { reloadPreview(); if (go) go(); });
    });
  }

  // The session card: every KEPT change, summarized from its resolved
  // patch, with Publish / Discard all apart from the per-change controls.
  function renderSession() {
    var cardEl = $('session-card');
    var staged = state.staged || [];
    if (!staged.length) { cardEl.hidden = true; return; }
    var list = $('staged-list');
    clear(list);
    staged.forEach(function (entry, i) {
      var row = el('div', 'staged-row');
      row.appendChild(el('span', 'staged-num', String(i + 1) + '.'));
      row.appendChild(el('span', 'staged-summary', entry.summary));
      list.appendChild(row);
    });
    $('btn-publish').textContent = staged.length === 1
      ? 'Publish 1 change'
      : 'Publish ' + staged.length + ' changes';
    cardEl.hidden = false;
  }

  // ── Editors ──────────────────────────────────────────────────
  function closeEditor() {
    reopen = null;
    var ed = $('editor');
    clear(ed);
    ed.hidden = true;
  }

  function editorShell(title) {
    var ed = $('editor');
    clear(ed);
    ed.hidden = false;
    ed.appendChild(el('h2', null, title));
    return ed;
  }

  function editorError(ed, text) {
    var old = ed.querySelector('.message');
    if (old) old.remove();
    var m = el('div', 'message error', text);
    ed.insertBefore(m, ed.children[1] || null);
  }

  // Stage a change: POST the patch (and optional upload), then show the
  // pending review and refresh the preview with the candidate rebuild. The
  // editor is NOT closed here — when an editor is open (reopen set),
  // renderPending() shows the review inside it and Keep re-opens it in place;
  // only a one-shot flow that closed itself first falls back to the standalone
  // pending card.
  function stage(patch, upload, ed) {
    return apiPost('/api/edit', { patch: patch, upload: upload || undefined }).then(function (r) {
      if (!r.ok) {
        if (ed) editorError(ed, r.error); else showMessage('error', r.error);
        return;
      }
      clearMessage();
      return refreshState().then(reloadPreview);
    });
  }

  function fieldTitle(ref) {
    var t = ref.field;
    if (ref.item) t = ref.item + ' · ' + t;
    return 'Edit: ' + t;
  }

  function basePatch(ref, action) {
    var p = { action: action, block: ref.block, field: ref.field };
    if (ref.item != null && ref.item !== '') p.item = ref.item;
    return p;
  }

  function openEditor(ref) {
    if (state && state.pending) {
      showMessage('info', 'You already have a pending change — keep or discard it first.');
      return;
    }
    clearMessage();
    reopen = null;   // cleared until a render succeeds (set at the end)
    var params = new URLSearchParams({ block: ref.block, field: ref.field });
    if (ref.item != null && ref.item !== '') params.set('item', ref.item);
    if (ref.index != null && ref.index !== '') params.set('index', ref.index);
    apiGet('/api/field?' + params.toString()).then(function (info) {
      if (!info.ok) { showMessage('error', info.error); return; }
      if (info.kind === 'text' && info.button) renderButtonEditor(ref, info);
      else if (info.kind === 'text' || info.kind === 'long-text') renderTextEditor(ref, info);
      else if (info.kind === 'list-line') renderLineEditor(ref, info);
      else if (info.kind === 'text-list') renderTextListEditor(ref, info);
      else if (info.kind === 'image') renderImageEditor(ref, info);
      else if (info.kind === 'image-list') renderImageListEditor(ref, info);
      else if (info.kind === 'toggle') editorShell(fieldTitle(ref));
      else { showMessage('error', 'This field cannot be edited here.'); return; }
      appendItemControls(ref, info);
      appendVisibilityToggle(ref, info);
      // The editor rendered — remember how to re-open it after a save so the
      // editor stays in place through the keep cycle (see renderInlinePending).
      reopen = function () { openEditor(ref); };
    });
  }

  // Repeating items (v4.2 Task 4): when the clicked element is an item of
  // a block whose type has at least one item blueprint, the editor pane
  // offers "Add <thing>…" (the same form the Add… menu generates from the
  // blueprint's input schema) and, on the clicked item itself, "Remove
  // this <thing>" with an explicit confirm derived from the item's
  // current content. Both flow into the same pending → keep → publish
  // cycle as everything else; the server enforces every constraint.
  function appendItemControls(ref, info) {
    var ed = $('editor');
    if (ed.hidden) return;
    if (info.itemRemove && info.itemRemove.allowed) {
      ed.appendChild(el('div', 'field-label', 'This ' + info.itemRemove.thing.toLowerCase()));
      var row = el('div', 'btn-row');
      row.appendChild(button('Remove this ' + info.itemRemove.thing.toLowerCase(), 'danger', function () {
        if (!window.confirm('Remove this ' + info.itemRemove.thing.toLowerCase() + '?\n\n'
            + info.itemRemove.summary + '\n\nIt goes live when you publish this session.')) return;
        apiPost('/api/remove-item', { block: ref.block, item: ref.item }).then(function (r) {
          if (!r.ok) { editorError(ed, r.error); return; }
          clearMessage();
          closeEditor();
          refreshState().then(reloadPreview);
        });
      }));
      ed.appendChild(row);
    }
    if (info.addable && info.addable.length) {
      ed.appendChild(el('div', 'field-label', 'This section'));
      var addRow = el('div', 'btn-row');
      info.addable.forEach(function (a) {
        addRow.appendChild(button('Add ' + a.name.toLowerCase() + '…', null, function () {
          apiGet('/api/blueprints').then(function (r) {
            if (!r.ok) { showMessage('error', r.error); return; }
            var bp = null;
            r.blueprints.forEach(function (b) { if (b.key === a.key) bp = b; });
            if (bp) openScaffoldForm(bp, ref.block);
          });
        }));
      });
      ed.appendChild(addRow);
    }
  }

  // Section visibility: every editor opened for a block also offers the
  // block-level hide/show toggle (no separate hidden-blocks panel — the
  // owner reaches it through the same click that edits any field of the
  // section). Shown only when the block carries the seeded flag.
  function appendVisibilityToggle(ref, info) {
    if (typeof info.blockHidden !== 'boolean' && info.kind !== 'toggle') return;
    var hidden = info.kind === 'toggle' ? info.value === true : info.blockHidden;
    var ed = $('editor');
    if (ed.hidden) return;
    ed.appendChild(el('div', 'field-label', 'This whole section'));
    ed.appendChild(el('div', 'hint', hidden
      ? 'This section is hidden — visitors do not see it on the live site.'
      : 'Visitors currently see this section on the live site.'));
    var row = el('div', 'btn-row');
    row.appendChild(button(hidden ? 'Show this section again' : 'Hide this section', null, function () {
      stage({ action: 'set', block: ref.block, field: 'hidden', value: !hidden }, null, ed);
    }));
    if (info.kind === 'toggle') row.appendChild(button('Cancel', null, closeEditor));
    ed.appendChild(row);
  }

  // Short text → input; long text → textarea.
  function renderTextEditor(ref, info) {
    var ed = editorShell(fieldTitle(ref));
    ed.appendChild(el('div', 'field-label', info.field));
    var input = info.kind === 'long-text' ? el('textarea') : el('input');
    if (input.tagName === 'INPUT') input.type = 'text';
    input.value = String(info.value === null || info.value === undefined ? '' : info.value);
    ed.appendChild(input);
    var row = el('div', 'btn-row');
    row.appendChild(button('Save', 'primary', function () {
      var p = basePatch(ref, 'set');
      p.value = input.value;
      stage(p, null, ed);
    }));
    row.appendChild(button('Cancel', null, closeEditor));
    ed.appendChild(row);
    input.focus();
  }

  // A CTA button (hero action): its text, link, and style all live on one
  // <a>, so the click that lands on the button opens this combined editor
  // (the overlay resolved it to field=label, the single annotated element).
  // Each field saves as its OWN guarded set patch through the normal stage()
  // path — the one-pending-change model is unchanged, and the candidate build
  // validates the link (safeHref) and style (enum), rolling back on a bad value.
  function renderButtonEditor(ref, info) {
    var ed = editorShell('Edit button');

    ed.appendChild(el('div', 'field-label', 'Button text'));
    var labelInput = el('input');
    labelInput.type = 'text';
    labelInput.value = String(info.value == null ? '' : info.value);
    ed.appendChild(labelInput);
    ed.appendChild(el('div', 'btn-row')).appendChild(button('Save text', 'primary', function () {
      var p = basePatch(ref, 'set');   // ref.field is already 'label'
      p.value = labelInput.value;
      stage(p, null, ed);
    }));

    ed.appendChild(el('div', 'field-label', 'Where it links'));
    ed.appendChild(el('div', 'hint', 'A page on this site (e.g. contact.html), or a full https:// , tel: , or mailto: link.'));
    var hrefInput = el('input');
    hrefInput.type = 'text';
    hrefInput.value = String(info.button.href == null ? '' : info.button.href);
    ed.appendChild(hrefInput);
    ed.appendChild(el('div', 'btn-row')).appendChild(button('Save link', 'primary', function () {
      var p = basePatch(ref, 'set');
      p.field = 'href';
      p.value = hrefInput.value;
      stage(p, null, ed);
    }));

    ed.appendChild(el('div', 'field-label', 'Style'));
    var sel = el('select');
    [['primary', 'Filled (primary)'], ['secondary', 'Outline (secondary)']].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      if (o[0] === info.button.style) opt.selected = true;
      sel.appendChild(opt);
    });
    ed.appendChild(sel);
    ed.appendChild(el('div', 'btn-row')).appendChild(button('Save style', 'primary', function () {
      var p = basePatch(ref, 'set');
      p.field = 'style';
      p.value = sel.value;
      stage(p, null, ed);
    }));

    ed.appendChild(el('div', 'btn-row')).appendChild(button('Cancel', null, closeEditor));
  }

  // One line of a text list: edit it (match form built from the EXACT
  // current line), remove it, or add a new line to the list.
  function renderLineEditor(ref, info) {
    var ed = editorShell(fieldTitle(ref));
    var original = String(info.value);

    ed.appendChild(el('div', 'field-label', 'This line'));
    var input = el('input');
    input.type = 'text';
    input.value = original;
    ed.appendChild(input);

    var row = el('div', 'btn-row');
    row.appendChild(button('Save line', 'primary', function () {
      var p = basePatch(ref, 'set');
      p.match = original;
      p.value = input.value;
      stage(p, null, ed);
    }));
    row.appendChild(button('Remove line', 'danger', function () {
      var p = basePatch(ref, 'delete');
      p.match = original;
      stage(p, null, ed);
    }));
    row.appendChild(button('Cancel', null, closeEditor));
    ed.appendChild(row);

    appendAddLine(ed, ref);
    input.focus();
  }

  // A whole string list annotated as one element (e.g. card checklists):
  // pick a line to edit/remove, or add one.
  function renderTextListEditor(ref, info) {
    var ed = editorShell(fieldTitle(ref));
    var list = el('div', 'line-list');
    info.lines.forEach(function (line) {
      var row = el('div', 'line-row');
      row.appendChild(el('span', 'line-text', line));
      row.appendChild(button('Edit', null, function () {
        renderLineEditor(ref, { field: info.field, value: line });
      }));
      row.appendChild(button('Remove', 'danger', function () {
        var p = basePatch(ref, 'delete');
        p.match = line;
        stage(p, null, ed);
      }));
      list.appendChild(row);
    });
    ed.appendChild(list);
    appendAddLine(ed, ref);
    ed.appendChild(el('div', 'btn-row')).appendChild(button('Cancel', null, closeEditor));
  }

  function appendAddLine(ed, ref) {
    ed.appendChild(el('div', 'field-label', 'Add a line (goes to the end)'));
    var input = el('input');
    input.type = 'text';
    ed.appendChild(input);
    var row = el('div', 'btn-row');
    row.appendChild(button('Add line', null, function () {
      if (!input.value) return;
      var p = basePatch(ref, 'append');
      p.value = input.value;
      stage(p, null, ed);
    }));
    ed.appendChild(row);
  }

  // ── Client-side image compression ────────────────────────────
  // The browser is the image-processing runtime: a multi-megabyte phone
  // photo is scaled and re-encoded HERE, before it is ever POSTed, so one
  // gallery upload can't make a page weigh 5 MB. This is a courtesy, not
  // a control — the server's upload guards (extension allowlist, size cap,
  // file-signature check) treat the result as untrusted input regardless.

  // MAX_EDGE: longest output edge in px — full-bleed-hero sharp on common displays, ~10x smaller than a phone photo.
  var MAX_EDGE = 1920;
  // QUALITY: jpeg/webp encoder quality — visually clean for photos while still compressing hard.
  var QUALITY = 0.82;
  // Files already this small are uploaded untouched.
  var COMPRESS_MIN_BYTES = 300 * 1024;
  // Output extension by the type the canvas ACTUALLY produced (a browser
  // may ignore the requested type) — the uploaded filename must agree with
  // the bytes or the server's signature guard rightly refuses them.
  var EXT_BY_TYPE = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' };

  // Returns a Promise of { blob, name }: the bytes to upload and a filename
  // whose extension matches them. Skips GIFs (animation) and small files;
  // ANY failure falls back to the original file — a failed compression must
  // never block an upload the server would have accepted.
  function compressImage(file) {
    var original = { blob: file, name: file.name };
    if (typeof window.createImageBitmap !== 'function') return Promise.resolve(original);
    if (file.type === 'image/gif' || file.size < COMPRESS_MIN_BYTES) return Promise.resolve(original);
    // 'from-image' bakes the EXIF rotation into the pixels, so a portrait
    // phone photo stays upright; the canvas re-encode below then strips ALL
    // metadata — including GPS position — a deliberate privacy property.
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
      var scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height)); // never upscale
      var w = Math.max(1, Math.round(bmp.width * scale));
      var h = Math.max(1, Math.round(bmp.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      bmp.close();
      // PNG → webp (keeps the alpha channel); everything else → jpeg.
      var wantType = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, wantType, QUALITY);
      });
    }).then(function (blob) {
      // Never ship a larger file, and never a type the name can't agree with.
      if (!blob || blob.size >= file.size || !EXT_BY_TYPE[blob.type]) return original;
      var name = file.name.replace(/\.[^./\\]+$/, '') + EXT_BY_TYPE[blob.type];
      return { blob: blob, name: name };
    }).catch(function () {
      return original; // decode failure: send the original untouched
    });
  }

  function readFileAsUpload(file) {
    return compressImage(file).then(function (prepared) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          var dataUrl = String(fr.result);
          resolve({ name: prepared.name, dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
        };
        fr.onerror = function () { reject(new Error('could not read the file')); };
        fr.readAsDataURL(prepared.blob);
      });
    });
  }

  // An <img> with its src set through the DOM (never an HTML string), used for
  // the editor's image thumbnails.
  function imageThumb(src) {
    var img = el('img', 'editor-image');
    if (src) img.src = src;
    img.alt = '';
    return img;
  }

  // Image field: pick a file; the server stores it in the client's img/
  // folder and builds the path patch itself.
  function renderImageEditor(ref, info) {
    var ed = editorShell(fieldTitle(ref));

    // Show the CURRENT image as a real thumbnail (served from the candidate
    // build under /preview/), not just its path — so the owner can see what
    // they are replacing. An inherited page-header background shows the hero.
    ed.appendChild(el('div', 'field-label', info.inherited ? 'Current image (inherited from the site hero)' : 'Current image'));
    if (info.value) {
      ed.appendChild(imageThumb('/preview/' + info.value));
      ed.appendChild(el('div', 'line-text', String(info.value)));
    } else {
      ed.appendChild(el('div', 'editor-image-empty', 'No image yet.'));
    }

    ed.appendChild(el('div', 'field-label', 'Replace with'));
    var file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif';
    ed.appendChild(file);

    // Preview the CHOSEN file the moment it is picked, so "Use this image" is
    // grounded in what the owner just selected instead of a silent file input.
    // (The upload is re-encoded server-bound; the preview shows the original,
    // which is visually identical.)
    var chosen = imageThumb('');
    chosen.style.display = 'none';
    ed.appendChild(chosen);
    var chosenUrl = null;
    file.addEventListener('change', function () {
      if (chosenUrl) { URL.revokeObjectURL(chosenUrl); chosenUrl = null; }
      if (file.files && file.files[0]) {
        chosenUrl = URL.createObjectURL(file.files[0]);
        chosen.src = chosenUrl;
        chosen.style.display = 'block';
      } else {
        chosen.removeAttribute('src');
        chosen.style.display = 'none';
      }
    });

    var row = el('div', 'btn-row');
    row.appendChild(button('Use this image', 'primary', function () {
      if (!file.files || !file.files[0]) { editorError(ed, 'Choose an image file first.'); return; }
      readFileAsUpload(file.files[0]).then(function (upload) {
        stage(basePatch(ref, 'set'), upload, ed);
      }, function (e) { editorError(ed, e.message); });
    }));
    row.appendChild(button('Cancel', null, closeEditor));
    ed.appendChild(row);

    // Hero backgrounds also offer reposition + zoom (when the block carries
    // the seeded bgPosition/bgZoom fields). Each saves as its own set patch
    // through the normal stage() path — the engine guards the values.
    if (info.heroFocal) appendHeroFocal(ed, ref, info);
  }

  // Parse a "<x>% <y>%" focal point into clamped 0–100 numbers.
  function parseFocal(s) {
    var m = String(s == null ? '' : s).match(/(\d{1,3})%\s+(\d{1,3})%/);
    var clamp = function (n) { return Math.max(0, Math.min(100, n)); };
    return m ? { x: clamp(+m[1]), y: clamp(+m[2]) } : { x: 50, y: 50 };
  }

  // Reposition (drag a handle over a thumbnail) + zoom (slider) for the hero
  // background. The thumbnail and dot give live feedback; "Save focus" /
  // "Save zoom" each emit one set patch ({field:'bgPosition'|'bgZoom'}).
  function appendHeroFocal(ed, ref, info) {
    var pos = parseFocal(info.heroFocal.position);

    ed.appendChild(el('div', 'field-label', 'Reposition the background'));
    ed.appendChild(el('div', 'hint', 'Drag the dot to choose what stays centred, then save.'));
    var box = el('div', 'hero-focal');
    // info.value is the current image path (e.g. "img/banner.jpg"), served
    // under /preview/. setProperty keeps the value out of any HTML string.
    box.style.backgroundImage = "url('/preview/" + info.value + "')";
    box.style.backgroundPosition = pos.x + '% ' + pos.y + '%';
    var dot = el('div', 'hero-focal-dot');
    var placeDot = function () { dot.style.left = pos.x + '%'; dot.style.top = pos.y + '%'; };
    placeDot();
    box.appendChild(dot);
    ed.appendChild(box);

    function setFrom(ev) {
      var r = box.getBoundingClientRect();
      pos = {
        x: Math.max(0, Math.min(100, Math.round((ev.clientX - r.left) / r.width * 100))),
        y: Math.max(0, Math.min(100, Math.round((ev.clientY - r.top) / r.height * 100))),
      };
      box.style.backgroundPosition = pos.x + '% ' + pos.y + '%';
      placeDot();
    }
    box.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      setFrom(ev);
      function move(e2) { setFrom(e2); }
      function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    var posRow = el('div', 'btn-row');
    posRow.appendChild(button('Save focus', 'primary', function () {
      var p = basePatch(ref, 'set');
      p.field = 'bgPosition';
      p.value = pos.x + '% ' + pos.y + '%';
      stage(p, null, ed);
    }));
    ed.appendChild(posRow);

    ed.appendChild(el('div', 'field-label', 'Zoom'));
    var zoomRow = el('div', 'hero-zoom');
    var slider = el('input');
    slider.type = 'range';
    slider.min = '1'; slider.max = '3'; slider.step = '0.1';
    slider.value = String(info.heroFocal.zoom);
    var readout = el('span', 'hero-zoom-readout', Number(info.heroFocal.zoom).toFixed(1) + '×');
    slider.addEventListener('input', function () { readout.textContent = Number(slider.value).toFixed(1) + '×'; });
    zoomRow.appendChild(slider);
    zoomRow.appendChild(readout);
    ed.appendChild(zoomRow);
    var saveZoomRow = el('div', 'btn-row');
    saveZoomRow.appendChild(button('Save zoom', 'primary', function () {
      var p = basePatch(ref, 'set');
      p.field = 'bgZoom';
      p.value = Number(slider.value);
      stage(p, null, ed);
    }));
    ed.appendChild(saveZoomRow);
  }

  // Gallery image list: remove an existing photo (match form) or add one
  // (upload + append).
  function renderImageListEditor(ref, info) {
    var ed = editorShell(fieldTitle(ref));
    var list = el('div', 'line-list');
    info.lines.forEach(function (line) {
      var row = el('div', 'line-row');
      row.appendChild(el('span', 'line-text', line));
      row.appendChild(button('Remove', 'danger', function () {
        var p = basePatch(ref, 'delete');
        p.match = line;
        stage(p, null, ed);
      }));
      list.appendChild(row);
    });
    ed.appendChild(list);
    ed.appendChild(el('div', 'field-label', 'Add a photo'));
    var file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif';
    ed.appendChild(file);
    var row = el('div', 'btn-row');
    row.appendChild(button('Add photo', 'primary', function () {
      if (!file.files || !file.files[0]) { editorError(ed, 'Choose an image file first.'); return; }
      readFileAsUpload(file.files[0]).then(function (upload) {
        stage(basePatch(ref, 'append'), upload, ed);
      }, function (e) { editorError(ed, e.message); });
    }));
    row.appendChild(button('Cancel', null, closeEditor));
    ed.appendChild(row);
  }

  // ── Section panel (the per-section doorway) ──────────────────
  // Opened by the preview overlay's section chip (postMessage 'bk-section').
  // Consolidates a section's settings (background, style, visibility) and the
  // optional fields it could ADD but omits — each routed to the SAME field
  // editor / toggle path a normal click uses, so the panel adds no new write
  // surface. Drilling into a setting replaces this panel with that editor.
  function openSectionEditor(block) {
    if (state && state.pending) {
      showMessage('info', 'You already have a pending change — keep or discard it first.');
      return;
    }
    clearMessage();
    reopen = null;   // a panel, not a keep-in-place editor
    apiGet('/api/section?block=' + encodeURIComponent(block)).then(function (info) {
      if (!info.ok) { showMessage('error', info.error); return; }
      var ed = editorShell('Section settings');
      ed.appendChild(el('p', 'hint', 'Settings for this ' + sectionTypeLabel(info.type) + ' section.'));

      if (info.background) {
        ed.appendChild(el('div', 'field-label', 'Background'));
        ed.appendChild(el('div', 'btn-row')).appendChild(
          button('Change background…', null, function () { openEditor({ block: block, field: 'background' }); }));
      }
      if (info.variant) {
        ed.appendChild(el('div', 'field-label', 'Style'));
        ed.appendChild(el('div', 'btn-row')).appendChild(
          button('Change style…', null, function () { openEditor({ block: block, field: 'variant' }); }));
      }

      // Add what this section could have but doesn't yet (e.g. a subtitle).
      if (info.addable && info.addable.length) {
        ed.appendChild(el('div', 'field-label', 'Add to this section'));
        var addRow = el('div', 'btn-row');
        info.addable.forEach(function (a) {
          addRow.appendChild(button('Add a ' + fieldLabel(a.field), null, function () {
            openEditor({ block: block, field: a.field });
          }));
        });
        ed.appendChild(addRow);
      }

      // Add a repeating item to this section from an item blueprint — the
      // empty-state doorway for a hero whose buttons (actions) are all gone, so
      // there is no button to click. Same scaffold form appendItemControls and
      // the Add… menu render from the blueprint's input schema.
      if (info.addItems && info.addItems.length) {
        ed.appendChild(el('div', 'field-label', 'Add to this section'));
        var addItemRow = el('div', 'btn-row');
        info.addItems.forEach(function (a) {
          addItemRow.appendChild(button('Add ' + a.name.toLowerCase() + '…', null, function () {
            apiGet('/api/blueprints').then(function (r) {
              if (!r.ok) { showMessage('error', r.error); return; }
              var bp = null;
              r.blueprints.forEach(function (b) { if (b.key === a.key) bp = b; });
              if (bp) openScaffoldForm(bp, block);
            });
          }));
        });
        ed.appendChild(addItemRow);
      }

      // Section visibility, when the flag is seeded on this block.
      if (typeof info.hidden === 'boolean') {
        ed.appendChild(el('div', 'field-label', 'This whole section'));
        ed.appendChild(el('div', 'hint', info.hidden
          ? 'This section is hidden — visitors do not see it on the live site.'
          : 'Visitors currently see this section on the live site.'));
        ed.appendChild(el('div', 'btn-row')).appendChild(
          button(info.hidden ? 'Show this section again' : 'Hide this section', null, function () {
            stage({ action: 'set', block: block, field: 'hidden', value: !info.hidden }, null, ed);
          }));
      }

      ed.appendChild(el('div', 'btn-row')).appendChild(button('Cancel', null, closeEditor));
    });
  }

  // ── Add… (blueprint scaffolding) ─────────────────────────────
  // The Add… menu lists the validated blueprint registry; choosing one
  // renders a form generated from its declared input schema, and the
  // result flows into the same candidate → pending → keep → publish cycle.
  function openAddMenu() {
    if (state && state.pending) {
      showMessage('info', 'You already have a pending change — keep or discard it first.');
      return;
    }
    clearMessage();
    reopen = null;   // a panel, not a keep-in-place editor
    apiGet('/api/blueprints').then(function (r) {
      var ed = editorShell('Add to the site');
      if (!r.ok) { editorError(ed, r.error); return; }
      var list = el('div', 'line-list');
      r.blueprints.forEach(function (bp) {
        // Item blueprints are offered on the block they extend (see
        // appendItemControls), not here — they need a target section,
        // which clicking into the section supplies.
        if (bp.kind === 'item') return;
        var row = el('div', 'bp-row');
        var text = el('div', 'bp-text');
        text.appendChild(el('div', 'bp-name', bp.name));
        text.appendChild(el('div', 'hint', bp.purpose));
        row.appendChild(text);
        row.appendChild(button('Choose', null, function () { openScaffoldForm(bp); }));
        list.appendChild(row);
      });
      if (!r.blueprints.length) list.appendChild(el('div', 'hint', 'No blueprints are installed.'));
      ed.appendChild(list);
      (r.invalid || []).forEach(function (bad) {
        ed.appendChild(el('div', 'message error',
          'Blueprint "' + bad.file + '" is invalid and was not listed:\n' + bad.errors.join('\n')));
      });
      var row = el('div', 'btn-row');
      row.appendChild(button('Cancel', null, closeEditor));
      ed.appendChild(row);
    });
  }

  // `targetBlock` is set only for item blueprints: the id of the section
  // the owner clicked, which the new item is appended to.
  function openScaffoldForm(bp, targetBlock) {
    reopen = null;   // a one-shot create form, not a keep-in-place editor
    var ed = editorShell('Add: ' + bp.name);
    ed.appendChild(el('p', 'hint', bp.purpose));

    var variantKey = bp.variants[0].key;
    ed.appendChild(el('div', 'field-label', 'Layout'));
    var variantBox = el('div', 'variant-box');
    bp.variants.forEach(function (v) {
      var lab = el('label', 'variant-option');
      var radio = el('input');
      radio.type = 'radio';
      radio.name = 'bk-variant';
      radio.checked = v.key === variantKey;
      radio.addEventListener('change', function () {
        if (radio.checked) { variantKey = v.key; renderInputs(); }
      });
      lab.appendChild(radio);
      lab.appendChild(document.createTextNode(' ' + v.label));
      variantBox.appendChild(lab);
    });
    ed.appendChild(variantBox);

    // Target page selector for block-kind blueprints.
    var targetSelect = null;
    if (bp.kind === 'block') {
      ed.appendChild(el('div', 'field-label', 'Add to which page?'));
      targetSelect = el('select');
      (state.pages || []).forEach(function (slug) {
        var opt = el('option', null, slug);
        opt.value = slug;
        targetSelect.appendChild(opt);
      });
      ed.appendChild(targetSelect);
    }

    // Inputs are re-rendered when the variant changes, showing only the
    // inputs active for that layout. Entered values survive the switch.
    var inputsBox = el('div');
    ed.appendChild(inputsBox);
    var controls = {};   // key -> {get: fn} or {file: input}

    function inputActive(inp) {
      return !inp.variants || inp.variants.indexOf(variantKey) !== -1;
    }

    function renderInputs() {
      clear(inputsBox);
      bp.inputs.forEach(function (inp) {
        if (!inputActive(inp)) return;
        inputsBox.appendChild(el('div', 'field-label', inp.label + (inp.required ? '' : ' (optional)')));
        if (inp.type === 'select') {
          var sel = controls[inp.key] && controls[inp.key].node ? controls[inp.key].node : el('select');
          if (!sel.options.length) {
            inp.options.forEach(function (o) {
              var val = typeof o === 'string' ? o : o.value;
              var opt = el('option', null, typeof o === 'string' ? o : o.label);
              opt.value = val;
              sel.appendChild(opt);
            });
          }
          controls[inp.key] = { node: sel, get: function () { return sel.value; } };
          inputsBox.appendChild(sel);
        } else if (inp.type === 'image') {
          var file = controls[inp.key] && controls[inp.key].node ? controls[inp.key].node : el('input');
          file.type = 'file';
          file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif';
          controls[inp.key] = { node: file, file: file };
          inputsBox.appendChild(file);
        } else {
          var field = controls[inp.key] && controls[inp.key].node
            ? controls[inp.key].node
            : (inp.type === 'textarea' ? el('textarea') : el('input'));
          if (field.tagName === 'INPUT') field.type = 'text';
          if (inp.maxLength) field.maxLength = inp.maxLength;
          controls[inp.key] = { node: field, get: function () { return field.value; } };
          inputsBox.appendChild(field);
        }
      });
    }
    renderInputs();

    var row = el('div', 'btn-row');
    row.appendChild(button('Create preview', 'primary', function () {
      var values = {};
      var filePromises = [];
      var uploads = {};
      bp.inputs.forEach(function (inp) {
        if (!inputActive(inp)) return;
        var c = controls[inp.key];
        if (!c) return;
        if (c.file) {
          if (c.file.files && c.file.files[0]) {
            filePromises.push(readFileAsUpload(c.file.files[0]).then(function (u) { uploads[inp.key] = u; }));
          }
        } else {
          values[inp.key] = c.get();
        }
      });
      Promise.all(filePromises).then(function () {
        var body = { blueprint: bp.key, variant: variantKey, values: values, uploads: uploads };
        if (targetSelect) body.targetPage = targetSelect.value;
        if (targetBlock) body.targetBlock = targetBlock;
        apiPost('/api/scaffold', body).then(function (r) {
          if (!r.ok) { editorError(ed, r.error); return; }
          clearMessage();
          closeEditor();
          if (r.created && r.created.file) currentPath = '/preview/' + r.created.file;
          refreshState().then(reloadPreview);
        });
      }, function (e) { editorError(ed, e.message); });
    }));
    if (bp.kind !== 'item') row.appendChild(button('Back', null, openAddMenu));
    row.appendChild(button('Cancel', null, closeEditor));
    ed.appendChild(row);
  }

  $('btn-add').addEventListener('click', openAddMenu);

  // ── Brand colors ─────────────────────────────────────────────
  function renderTokens() {
    var list = $('token-list');
    clear(list);
    (state.tokens || []).forEach(function (t) {
      var row = el('div', 'token-row');
      row.appendChild(el('span', 'token-name', TOKEN_LABELS[t.token] || t.token));
      row.appendChild(el('span', 'token-value', t.value === null ? 'theme default' : t.value));
      row.appendChild(button('Change', null, function () { openTokenEditor(t); }));
      list.appendChild(row);
    });
  }

  // The token editor runs the format + contrast guards LIVE as the owner
  // picks: every change is sent to /api/token-check (which applies the
  // resolver to a throwaway copy) and the guard's own plain-language
  // explanation is shown inline when a value is rejected.
  function openTokenEditor(token) {
    if (state.pending) {
      showMessage('info', 'You already have a pending change — keep or discard it first.');
      return;
    }
    clearMessage();
    // Re-open this token editor after a save, re-derived from fresh state so a
    // kept change shows its new value as the current one.
    reopen = function () {
      var fresh = (state.tokens || []).filter(function (t) { return t.token === token.token; })[0];
      openTokenEditor(fresh || token);
    };
    var ed = editorShell('Change: ' + (TOKEN_LABELS[token.token] || token.token));
    var holder = el('div', 'token-editor');
    var feedback = el('div', 'token-feedback');
    var stageBtn = button('Save', 'primary', function () {
      stage({ action: 'set-token', token: token.token, value: valueInput.value }, null, ed);
    });
    stageBtn.disabled = true;

    var valueInput = el('input');
    valueInput.type = 'text';

    function check(value) {
      clearTimeout(tokenCheckTimer);
      tokenCheckTimer = setTimeout(function () {
        apiPost('/api/token-check', { token: token.token, value: value }).then(function (r) {
          if (r.ok) {
            feedback.className = 'token-feedback good';
            feedback.textContent = 'Looks good — readable against the theme.';
            stageBtn.disabled = false;
          } else {
            feedback.className = 'token-feedback bad';
            feedback.textContent = r.error;
            stageBtn.disabled = true;
          }
        });
      }, 200);
    }

    if (token.type === 'opacity') {
      var slider = el('input');
      slider.type = 'range';
      slider.min = '0'; slider.max = '1'; slider.step = '0.05';
      var current = token.value !== null && !isNaN(parseFloat(token.value)) ? String(parseFloat(token.value)) : '0.5';
      slider.value = current;
      valueInput.value = current;
      slider.addEventListener('input', function () {
        valueInput.value = slider.value;
        check(slider.value);
      });
      holder.appendChild(el('div', 'field-label', 'Darkness (0 = none, 1 = black)'));
      holder.appendChild(slider);
    } else {
      var picker = el('input');
      picker.type = 'color';
      if (/^#[0-9a-fA-F]{6}$/.test(String(token.value))) picker.value = token.value;
      picker.addEventListener('input', function () {
        valueInput.value = picker.value;
        check(picker.value);
      });
      holder.appendChild(el('div', 'field-label', 'Pick a color'));
      holder.appendChild(picker);
      valueInput.value = token.value === null ? '' : String(token.value);
    }

    holder.appendChild(el('div', 'field-label', 'Or type one (e.g. #2D6A4F, navy, rgb(45,106,79))'));
    valueInput.addEventListener('input', function () { check(valueInput.value); });
    holder.appendChild(valueInput);
    holder.appendChild(feedback);
    var row = el('div', 'btn-row');
    row.appendChild(stageBtn);
    row.appendChild(button('Cancel', null, closeEditor));
    holder.appendChild(row);
    ed.appendChild(holder);
    if (valueInput.value) check(valueInput.value);
  }

  // ── Keep / publish / discard / restore ───────────────────────
  $('btn-keep').addEventListener('click', function () {
    apiPost('/api/keep').then(function (r) {
      if (!r.ok) { showMessage('error', r.error); return; }
      showMessage('info', 'Change kept — it goes live when you publish this session.');
      refreshState();
    });
  });

  $('btn-publish').addEventListener('click', function () {
    $('btn-publish').disabled = true;
    apiPost('/api/publish').then(function (r) {
      $('btn-publish').disabled = false;
      if (!r.ok) { showMessage('error', r.error); return; }
      showMessage(r.publish.ok ? 'ok' : 'error', r.publish.message);
      refreshState().then(reloadPreview);
    });
  });

  $('btn-discard').addEventListener('click', function () {
    apiPost('/api/discard').then(function (r) {
      if (!r.ok) { showMessage('error', r.error); return; }
      showMessage('info', 'Pending change discarded — anything you kept is still staged.');
      refreshState().then(reloadPreview);
    });
  });

  $('btn-discard-all').addEventListener('click', function () {
    if (!window.confirm('Discard everything from this session? The preview goes back to the live site.')) return;
    apiPost('/api/discard-all').then(function (r) {
      if (!r.ok) { showMessage('error', r.error); return; }
      showMessage('info', 'Session discarded — the preview is back to the live site.');
      refreshState().then(reloadPreview);
    });
  });

  $('btn-restore').addEventListener('click', function () {
    if (!window.confirm('Undo the last published change and republish the previous version?')) return;
    apiPost('/api/restore').then(function (r) {
      if (!r.ok) { showMessage('error', r.error); return; }
      showMessage(r.publish.ok ? 'ok' : 'error', r.publish.message);
      refreshState().then(reloadPreview);
    });
  });

  // ── Edit / Preview mode ──────────────────────────────────────
  // The mode is UI-side state, relayed to the preview iframe's overlay over
  // postMessage. The overlay starts every page load in edit mode, so the
  // mode is re-posted on every iframe load (navigations in preview mode, and
  // candidate rebuilds after an edit) to keep the two in step.
  var mode = 'edit';
  function postMode() {
    try {
      iframe.contentWindow.postMessage({ type: 'bk-mode', mode: mode }, window.location.origin);
    } catch (e) { /* iframe not ready yet — the load handler re-posts */ }
  }
  function setMode(m) {
    mode = m === 'preview' ? 'preview' : 'edit';
    $('btn-mode-edit').classList.toggle('is-active', mode === 'edit');
    $('btn-mode-preview').classList.toggle('is-active', mode === 'preview');
    $('mode-hint').textContent = mode === 'preview'
      ? 'Preview: the page behaves like the live site. Switch to Edit to make changes.'
      : '';
    if (mode === 'preview') { clearMessage(); closeEditor(); }
    postMode();
  }
  $('btn-mode-edit').addEventListener('click', function () { setMode('edit'); });
  $('btn-mode-preview').addEventListener('click', function () { setMode('preview'); });
  // Re-assert the current mode whenever the iframe (re)loads.
  iframe.addEventListener('load', postMode);

  // ── Overlay messages ─────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'bk-nav' && typeof e.data.path === 'string') {
      currentPath = e.data.path;
      return;
    }
    if (e.data.type === 'bk-edit') {
      openEditor({ block: e.data.block, item: e.data.item, field: e.data.field, index: e.data.index });
    }
    if (e.data.type === 'bk-section' && typeof e.data.block === 'string') {
      openSectionEditor(e.data.block);
    }
  });

  refreshState();
})();
