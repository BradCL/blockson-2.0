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

  var $ = function (id) { return document.getElementById(id); };
  var iframe = $('preview');

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
    closeEditor();
    $('pending-summary').textContent = state.pending.summary;
    diffValue($('pending-old'), state.pending.old);
    diffValue($('pending-new'), state.pending.new);
    cardEl.hidden = false;
  }

  // ── Editors ──────────────────────────────────────────────────
  function closeEditor() {
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
  // pending card and refresh the preview with the candidate rebuild.
  function stage(patch, upload, ed) {
    return apiPost('/api/edit', { patch: patch, upload: upload || undefined }).then(function (r) {
      if (!r.ok) {
        if (ed) editorError(ed, r.error); else showMessage('error', r.error);
        return;
      }
      clearMessage();
      closeEditor();
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
      showMessage('info', 'You already have a pending change — approve or discard it first.');
      return;
    }
    clearMessage();
    var params = new URLSearchParams({ block: ref.block, field: ref.field });
    if (ref.item != null && ref.item !== '') params.set('item', ref.item);
    if (ref.index != null && ref.index !== '') params.set('index', ref.index);
    apiGet('/api/field?' + params.toString()).then(function (info) {
      if (!info.ok) { showMessage('error', info.error); return; }
      if (info.kind === 'text' || info.kind === 'long-text') renderTextEditor(ref, info);
      else if (info.kind === 'list-line') renderLineEditor(ref, info);
      else if (info.kind === 'text-list') renderTextListEditor(ref, info);
      else if (info.kind === 'image') renderImageEditor(ref, info);
      else if (info.kind === 'image-list') renderImageListEditor(ref, info);
      else if (info.kind === 'toggle') editorShell(fieldTitle(ref));
      else { showMessage('error', 'This field cannot be edited here.'); return; }
      appendVisibilityToggle(ref, info);
    });
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

  // Image field: pick a file; the server stores it in the client's img/
  // folder and builds the path patch itself.
  function renderImageEditor(ref, info) {
    var ed = editorShell(fieldTitle(ref));
    ed.appendChild(el('div', 'field-label', 'Current image'));
    ed.appendChild(el('div', 'line-text', String(info.value)));
    ed.appendChild(el('div', 'field-label', 'Replace with'));
    var file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif';
    ed.appendChild(file);
    var row = el('div', 'btn-row');
    row.appendChild(button('Use this image', 'primary', function () {
      if (!file.files || !file.files[0]) { editorError(ed, 'Choose an image file first.'); return; }
      readFileAsUpload(file.files[0]).then(function (upload) {
        stage(basePatch(ref, 'set'), upload, ed);
      }, function (e) { editorError(ed, e.message); });
    }));
    row.appendChild(button('Cancel', null, closeEditor));
    ed.appendChild(row);
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

  // ── Add… (blueprint scaffolding) ─────────────────────────────
  // The Add… menu lists the validated blueprint registry; choosing one
  // renders a form generated from its declared input schema, and the
  // result flows into the same candidate → pending → Approve cycle.
  function openAddMenu() {
    if (state && state.pending) {
      showMessage('info', 'You already have a pending change — approve or discard it first.');
      return;
    }
    clearMessage();
    apiGet('/api/blueprints').then(function (r) {
      var ed = editorShell('Add to the site');
      if (!r.ok) { editorError(ed, r.error); return; }
      var list = el('div', 'line-list');
      r.blueprints.forEach(function (bp) {
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

  function openScaffoldForm(bp) {
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
        apiPost('/api/scaffold', body).then(function (r) {
          if (!r.ok) { editorError(ed, r.error); return; }
          clearMessage();
          closeEditor();
          if (r.created && r.created.file) currentPath = '/preview/' + r.created.file;
          refreshState().then(reloadPreview);
        });
      }, function (e) { editorError(ed, e.message); });
    }));
    row.appendChild(button('Back', null, openAddMenu));
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
      showMessage('info', 'You already have a pending change — approve or discard it first.');
      return;
    }
    clearMessage();
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

  // ── Approve / discard / restore ──────────────────────────────
  $('btn-approve').addEventListener('click', function () {
    $('btn-approve').disabled = true;
    apiPost('/api/approve').then(function (r) {
      $('btn-approve').disabled = false;
      if (!r.ok) { showMessage('error', r.error); return; }
      showMessage(r.publish.ok ? 'ok' : 'error', r.publish.message);
      refreshState().then(reloadPreview);
    });
  });

  $('btn-discard').addEventListener('click', function () {
    apiPost('/api/discard').then(function (r) {
      if (!r.ok) { showMessage('error', r.error); return; }
      showMessage('info', 'Change discarded — the preview is back to the live site.');
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
  });

  refreshState();
})();
