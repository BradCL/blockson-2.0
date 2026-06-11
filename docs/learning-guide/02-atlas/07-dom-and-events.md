# Atlas 07 — DOM manipulation and events in the editor UI

## In class you learned…

`document.getElementById`, `createElement`, `appendChild`,
`addEventListener`, and maybe `innerHTML` for quickly injecting markup.
Events bubble up from the element you clicked through its ancestors.

## In Blockson it lives at…

- `engine/ui/ui.js` — the editor app: builds every editor pane, button,
  and card with DOM APIs.
- `engine/ui/overlay.js` — the script injected into the preview iframe:
  hover-highlights editable elements and turns clicks into messages.
- `engine/ui/index.html` — the static shell both hang off: an iframe plus
  a panel of mostly-`hidden` sections that `ui.js` fills and reveals.

## A guided read-through

**The overlay** (`overlay.js`) is the best 70 lines of DOM education in
the repo. It must catch a click on *any* editable element in a page it
didn't write. One listener does it:

```js
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
```

Five classroom ideas, all load-bearing:

1. **Event delegation** — one listener on `document` instead of one per
   element; `closest('[data-bk-block]')` walks up from whatever was
   clicked to the nearest annotated ancestor.
2. **The capture phase** — that final `true`. Capture runs *before* the
   page's own handlers, so editing beats the gallery lightbox or a link
   navigation. The comment says exactly this: "editing wins."
3. **`preventDefault` / `stopPropagation`** — suppress the link's
   navigation and stop the page's handlers from also firing.
4. **`dataset`** — `data-bk-block` in HTML becomes `d.bkBlock` in JS;
   the annotations stamped at build time (atlas: see
   [the system map](../01-system-map.md)) are read back here.
5. **`postMessage`** — the preview runs in an iframe, so it talks to the
   editor app cross-document, with the target origin pinned to `ORIGIN`.

**The editor app** (`ui.js`) receives that message:

```js
window.addEventListener('message', function (e) {
  if (e.origin !== window.location.origin || !e.data || typeof e.data !== 'object') return;
  ...
  if (e.data.type === 'bk-edit') {
    openEditor({ block: e.data.block, item: e.data.item, field: e.data.field, index: e.data.index });
  }
});
```

Note the very first line: *check the sender's origin before trusting the
message.* Any page could call `postMessage` at this window.

Then `openEditor` asks the server what kind of field was clicked
(`GET /api/field`) and dispatches to `renderTextEditor`,
`renderLineEditor`, `renderImageEditor`, … each of which builds its pane
from three tiny helpers:

```js
function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
```

`textContent`, never `innerHTML`. The header comment states the rule as
policy: "No HTML string is ever assembled from site content." If a
headline contains `<script>`, `textContent` displays those nine
characters; `innerHTML` would *execute* them. This single choice is the
UI's whole XSS defense (more in [atlas 13](13-security-mindset.md)).

> **Term: XSS (cross-site scripting).** Tricking a page into running
> attacker-supplied JavaScript by smuggling it into content the page
> renders. The classic cause is interpolating untrusted text into HTML.

## What production adds

- **State lives in one place.** `ui.js` keeps a single `state` variable
  (the last `/api/state` payload); every render function reads from it,
  and after every server action `refreshState()` re-fetches and re-renders
  (`renderSession`, `renderPending`, `renderTokens`). That's the core loop
  of every UI framework — data down, events up — hand-rolled in 30 lines.
- **Debouncing.** The color picker fires `input` events continuously;
  `openTokenEditor`'s `check()` wraps the server call in a 200 ms
  `setTimeout` that each keystroke resets (`clearTimeout(tokenCheckTimer)`),
  so the server sees one request per pause, not one per keypress.
- **Disabled-until-valid buttons.** The token editor's Save button starts
  `disabled = true` and only enables when the live guard run says the
  value is acceptable — the UI can't even *offer* an action the server
  would refuse.
- **Optimistic nothing.** The UI never updates itself first and syncs
  later; every change round-trips through the server and comes back as
  fresh state. Slower in theory; impossible to de-sync in practice.

## Why here, why this way

No framework, again deliberately: the editor is one page, one state
object, a dozen render functions. But the deeper reason is the security
posture — frameworks escape output *by default*, and this code gets the
same property from plain `textContent` plus discipline, while staying
fully readable to anyone who knows the DOM. Every value on screen took
the same path: server JSON → `textContent`. When you can say that in one
sentence, you can audit it in one afternoon.
