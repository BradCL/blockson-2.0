/* ============================================================
   engine/ui/help.js — Owner editor Help assistant (optional).

   A self-contained "?" launcher + chat panel that answers the
   owner's how-to questions about the editor. Q&A runs entirely
   on-device through Chrome's built-in Prompt API (Gemini Nano):
   no API key, no server, no network — a perfect fit for the
   static, walk-away model. When the API is absent (any non-Chrome
   or mobile browser), the same launcher just shows the written
   guide, so the feature is purely additive and never blocks editing.

   Loaded as a plain global script AFTER ui.js, exactly like ui.js.
   It depends on nothing else: the grounding text is embedded below,
   so the one file drives both the Node localhost editor and the
   no-install browser demo with no fork and no build step.

   XSS posture matches ui.js: every value is rendered with
   textContent / DOM APIs. No HTML string is ever assembled.
   ============================================================ */
'use strict';

(function () {
  // ── Grounding corpus ────────────────────────────────────────
  // Compact, owner-voiced reference (the model's only source of truth).
  // Kept short on purpose: the on-device model has a small context
  // window, and the system prompt is never evicted from it. Mirrors the
  // in-editor hint strings and OPERATOR.md §11 capability boundary.
  var CORPUS = [
    'THE EDITOR, IN ONE LINE',
    'You edit your live website by clicking the thing you want to change, right in the preview on the left. Nothing goes live until you choose to publish.',
    '',
    'MAKING A CHANGE',
    '- Anything you can edit is highlighted in the preview. Click it (a headline, a paragraph, a photo, a button, a list item) and an editor opens on the right.',
    '- Make your change and save it. It then shows as a "Pending change" with a Now -> After comparison so you see exactly what is different.',
    '- Press Keep to add it to this session, or Discard to throw it away. Keep does NOT publish — it just collects the change. You can make as many changes as you like.',
    '',
    'THE SESSION ("Kept this session")',
    '- Everything you Keep stacks up in the "Kept this session" card. These changes are staged in the preview but are NOT on the live site yet.',
    '- Publish takes the whole batch live at once. Discard all throws the whole batch away.',
    '',
    'PUBLISHING AND UNDO',
    '- Click Publish to make every kept change live in one go.',
    '- Made a mistake? "Undo last publish" rolls the live site back to how it was before your most recent publish, in one click.',
    '',
    'WHAT YOU CAN CHANGE',
    '- Text: headlines, paragraphs, captions, button labels — click and type.',
    '- Photos: click a photo to swap it. Big phone photos are shrunk for you automatically. For the main banner photo you can also drag to set the focal point and zoom.',
    '- Lists and repeating items: services, gallery photos, team members, FAQs and the like — add, edit, remove, reorder.',
    '- Sections: hover a section to reach its settings; you can hide a section or edit its subtitle.',
    '- Brand colors: under "Brand colors" change your main color, button color, menu and footer backgrounds. Experiment freely — any combination that would be hard to read is rejected before it can reach the site.',
    '- Pages: "Add a page…" builds a new page from a ready-made layout; you preview it before anything is kept.',
    '',
    'GUARDRAILS (why you cannot break it)',
    '- You only ever edit one pending change at a time; keep or discard it before starting another.',
    '- Unsafe color choices are blocked automatically.',
    '- Nothing reaches the live site until you press Publish, and any publish can be undone.',
    '',
    'WHAT NEEDS YOUR DEVELOPER',
    'The editor is for content and color tweaks. Brand-new page layouts, new section types, structural or design changes, the contact-form destination, and anything technical are your developer\'s side. If you want one of those, contact your developer.',
  ].join('\n');

  var SYSTEM_PROMPT =
    'You are the built-in Help assistant for the Blockson site editor — the tool the ' +
    'user is looking at right now to edit their own website. Answer the user\'s how-to ' +
    'question using ONLY the reference below. Keep answers short, friendly and concrete: ' +
    'name the button or area they should click. If the answer is not in the reference ' +
    '(for example brand-new pages or sections, layout or design changes, or anything ' +
    'technical), say you are not sure and suggest they contact their developer. Never ' +
    'invent features.\n\nREFERENCE:\n' + CORPUS;

  // ── State ───────────────────────────────────────────────────
  var mode = null;       // 'live' | 'fallback' (resolved on first open)
  var session = null;    // lazily created LanguageModel session
  var busy = false;
  var els = {};          // cached DOM nodes

  // ── Small DOM helpers (textContent only — never innerHTML) ──
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ── Build the launcher + panel once, hidden ─────────────────
  function build() {
    var launcher = el('button', 'help-launcher', '?');
    launcher.type = 'button';
    launcher.title = 'Help';
    launcher.setAttribute('aria-label', 'Open help');
    launcher.addEventListener('click', openPanel);

    var panel = el('section', 'help-panel');
    panel.hidden = true;

    var head = el('div', 'help-head');
    head.appendChild(el('h2', null, 'Help'));
    var close = el('button', 'btn subtle help-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', closePanel);
    head.appendChild(close);

    var status = el('p', 'hint help-status');
    var transcript = el('div', 'help-transcript');

    var form = el('form', 'help-input-row');
    var input = el('input');
    input.type = 'text';
    input.placeholder = 'Ask how to do something…';
    input.autocomplete = 'off';
    var send = el('button', 'btn primary', 'Ask');
    send.type = 'submit';
    form.appendChild(input);
    form.appendChild(send);
    form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); input.value = ''; });

    var disclaimer = el('p', 'hint help-disclaimer',
      'This assistant runs in your browser and can make mistakes — double-check anything important.');
    disclaimer.hidden = true;

    panel.appendChild(head);
    panel.appendChild(status);
    panel.appendChild(transcript);
    panel.appendChild(form);
    panel.appendChild(disclaimer);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    els = { launcher: launcher, panel: panel, status: status, transcript: transcript, form: form, input: input, send: send, disclaimer: disclaimer };
  }

  // ── Transcript rendering ────────────────────────────────────
  function addMsg(who, text) {
    var row = el('div', 'help-msg ' + who, text);
    els.transcript.appendChild(row);
    els.transcript.scrollTop = els.transcript.scrollHeight;
    return row;
  }
  function setStatus(text) { els.status.textContent = text || ''; els.status.hidden = !text; }

  // The developer contact line ui.js renders from /api/state, reused as the
  // out-of-scope hand-off so the owner sees who to ask.
  function contactLine() {
    var c = document.getElementById('contact-line');
    return c && c.textContent ? c.textContent.trim() : '';
  }

  // ── Open / close ────────────────────────────────────────────
  function openPanel() {
    els.launcher.hidden = true;
    els.panel.hidden = false;
    if (mode === null) resolveMode();
    if (mode === 'live') els.input.focus();
  }
  function closePanel() {
    els.panel.hidden = true;
    els.launcher.hidden = false;
  }

  // Decide live vs. fallback, once, on first open.
  function resolveMode() {
    if (typeof LanguageModel === 'undefined' || !LanguageModel.availability) {
      enterFallback();
      return;
    }
    setStatus('Checking the built-in assistant…');
    Promise.resolve()
      .then(function () { return LanguageModel.availability(); })
      .then(function (status) {
        if (status === 'unavailable' || status === 'no') { enterFallback(); return; }
        mode = 'live';
        setStatus('');
        els.disclaimer.hidden = false;
        addMsg('bot', 'Hi! Ask me how to do anything in this editor — for example, "how do I change my hero photo?" It runs right here in your browser; your questions aren\'t sent to any server of ours.');
      })
      .catch(function () { enterFallback(); });
  }

  // Fallback: show the written guide, hide the input.
  function enterFallback() {
    mode = 'fallback';
    els.form.hidden = true;
    setStatus('Live Q&A needs Chrome on a desktop computer. Here is the written guide:');
    var guide = el('div', 'help-guide', CORPUS);
    els.transcript.appendChild(guide);
    var contact = contactLine();
    if (contact) addMsg('bot', 'For anything beyond the above, ' + contact);
  }

  // ── Ask (live mode) ─────────────────────────────────────────
  function ask(raw) {
    var text = (raw || '').trim();
    if (!text || busy || mode !== 'live') return;
    busy = true;
    els.send.disabled = true;
    addMsg('user', text);
    ensureSession()
      .then(function () { return stream(text); })
      .catch(function (err) {
        addMsg('bot', 'Sorry, the assistant could not answer just now. ' +
          (contactLine() || 'If this keeps happening, contact your developer.'));
        if (window.console) console.warn('[help]', err);
      })
      .then(function () { busy = false; els.send.disabled = false; setStatus(''); els.input.focus(); });
  }

  // Create the session lazily; the user's click satisfies the activation
  // the Prompt API requires before it may download the ~4GB model.
  function ensureSession() {
    if (session) return Promise.resolve(session);
    setStatus('Setting up the assistant…');
    var opts = {
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      monitor: function (m) {
        m.addEventListener('downloadprogress', function (e) {
          var pct = e && e.total ? Math.round((e.loaded / e.total) * 100) : null;
          setStatus(pct === null ? 'Setting up the assistant (one-time download)…'
                                 : 'Setting up the assistant — ' + pct + '% (one-time download)…');
        });
      },
    };
    return LanguageModel.create(opts).then(function (s) { session = s; setStatus(''); return s; });
  }

  // Stream the answer into a single growing bubble; fall back to a
  // non-streaming prompt() if streaming is unavailable.
  function stream(text) {
    var bubble = addMsg('bot', '');
    if (session.promptStreaming) {
      var s = session.promptStreaming(text);
      return (function () {
        if (typeof s[Symbol.asyncIterator] === 'function') {
          return (async function () {
            for await (var chunk of s) { bubble.textContent += chunk; els.transcript.scrollTop = els.transcript.scrollHeight; }
          })();
        }
        // Older shape: a ReadableStream of cumulative snapshots.
        var reader = s.getReader();
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            bubble.textContent = r.value;
            els.transcript.scrollTop = els.transcript.scrollHeight;
            return pump();
          });
        })();
      })();
    }
    return session.prompt(text).then(function (answer) { bubble.textContent = answer; });
  }

  // ── Boot ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
