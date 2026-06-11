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

---

## Try it

*(Editor running: `node engine/serve.js learning-lab`, browser at
`http://127.0.0.1:4173/`.)*

**Exercise 1 (predict, then verify).** *Question:* in the preview, what
happens when you click (a) the hero headline, and (b) a navigation menu
link? Same thing or different - and why would they differ? **Predict,
then click both.**

<details><summary>What you should see</summary>

The headline opens an editor pane (it carries `data-bk-*` attributes, so
the overlay's capture-phase handler intercepts). The nav link *navigates*
inside the preview - nav links are developer-managed, carry no
annotations, and the overlay's first line (`if (!el) return`) lets them
through on purpose.</details>

**Exercise 2 (predict, then verify).** Open your browser's developer
tools on the editor page, pick any annotated element inside the preview
iframe, and read its attributes. *Question:* which three (or four)
`data-bk-*` attributes can appear, and what does each one address?
Verify against the table in `engine/lib/annotate.js`'s header comment.

<details><summary>Answer sketch</summary>

`data-bk-block` (block id), `data-bk-item` (repeating-item id, when the
element belongs to one), `data-bk-field` (field name), `data-bk-index`
(line number, only on text-list lines).</details>

## Self-check

1. Why does the overlay's click listener pass `true` as the third
   argument to `addEventListener`?
   <details><summary>Answer</summary>That registers it for the *capture*
   phase, which runs before the page's own bubbling handlers - so
   editing beats lightboxes, accordions, and link navigation.</details>
2. How do the iframe and the editor app communicate, and what check
   guards each direction?
   <details><summary>Answer</summary>`window.parent.postMessage` from
   the overlay, a `message` listener in `ui.js` - the overlay pins the
   target origin, and the listener verifies `e.origin` before trusting
   anything.</details>
3. Why is `textContent` (never `innerHTML`) a security boundary?
   <details><summary>Answer</summary>`textContent` treats the value as
   inert text; `innerHTML` parses it as markup, so a value containing
   `<script>` (or an `onerror` attribute) would execute - that's
   XSS.</details>
4. Transfer: you want double-click on a gallery image to open the image
   editor directly. Which file changes, and what's the riskiest mistake
   available?
   <details><summary>Answer</summary>`engine/ui/overlay.js` (a `dblclick`
   capture listener posting the same `bk-edit` shape). The risky mistake:
   assembling any HTML from the element's content, or posting to `'*'`
   instead of the pinned origin.</details>
