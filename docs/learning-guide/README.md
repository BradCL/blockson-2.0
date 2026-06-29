# The Blockson learning guide

> **❄️ Frozen doc — snapshot, may lag the code.** This guide is maintained as a
> coherent teaching artifact, not updated on every change. Pending updates are
> tracked in [`docs/DEFERRED_DOC_UPDATES.md`](../DEFERRED_DOC_UPDATES.md) and
> applied in periodic reconciliation passes. Treat specifics (function names,
> field lists) as true-as-of its baseline; verify against the code before relying
> on them.

**The promise:** everything you learned in your software development
program is in this repository somewhere, working for its living — this
guide shows you where, and what the classroom version didn't tell you.
**The reader:** someone roughly three semesters into a diploma —
comfortable with variables, functions, OOP basics, HTML/CSS/JS, the DOM,
JSON, and git basics — who has never worked inside a production codebase.

Keep the repo open beside the guide; every chapter cites real files and
real function names, quotes only a few anchoring lines, and expects you
to read the rest in place. All hands-on work happens in a scratch client
(`node engine/new-client.js learning-lab`) — never in `engine/` or the
example clients.

## Two ways in — pick the one that matches how you learn

### PATH 1 — top-down (map first, then territory)

1. [The system map](01-system-map.md) — what Blockson is, the two data
   flows, the directory anatomy, the two-tier trust model.
2. The concept atlas, in order, [01](02-atlas/01-modules.md) through
   [13](02-atlas/13-security-mindset.md) — each chapter maps one
   classroom concept onto the code.
3. The traces: [Trace A](03-traces/trace-a-build.md) (a build, end to
   end), then [Trace B](03-traces/trace-b-owner-edit.md) (an owner edit,
   click to `git push`).
4. The **Try it** exercises and self-checks at the end of every chapter,
   as you go or as a second pass.

### PATH 2 — detail-first (one concrete thing, then zoom out)

1. [Trace A](03-traces/trace-a-build.md) — follow one command through
   every file it touches. Do its exercises immediately.
2. The atlas chapters that trace stepped through:
   [modules](02-atlas/01-modules.md) →
   [JSON as a data model](02-atlas/02-json-data-model.md) →
   [validation](02-atlas/03-validation.md) →
   [files & paths](02-atlas/04-files-and-paths.md) →
   [CLI arguments](02-atlas/05-cli-arguments.md) →
   [error handling](02-atlas/10-error-handling.md).
3. Now the [system map](01-system-map.md) — the picture will snap into
   place around what you've already walked.
4. [Trace B](03-traces/trace-b-owner-edit.md), then the remaining atlas:
   [HTTP server](02-atlas/06-http-server.md),
   [DOM & events](02-atlas/07-dom-and-events.md),
   [forms & honeypot](02-atlas/08-forms-and-honeypot.md),
   [images](02-atlas/09-images.md),
   [git automation](02-atlas/11-git-automation.md),
   [testing](02-atlas/12-testing-proofs.md),
   [security mindset](02-atlas/13-security-mindset.md).
5. Remaining exercises and quizzes.

*(Workflow-shaped walkthroughs with screenshots — "how do I set up a
client" / "how does the owner use the editor" — live separately in
[docs/tutorial/developer/](../tutorial/developer/README.md) and
[docs/tutorial/owner/](../tutorial/owner/README.md).)*

## Concept index — from classroom to code

| You learned in class… | Chapter | Primary file |
|---|---|---|
| modules, import/export | [Atlas 01](02-atlas/01-modules.md) | `engine/blocks/_registry.js` |
| JSON, parse/stringify | [Atlas 02](02-atlas/02-json-data-model.md) | `clients/*/content.json`, `engine/lib/patch.js` |
| validating input | [Atlas 03](02-atlas/03-validation.md) | `engine/lib/validate.js`, `engine/schema/content.schema.json` |
| reading/writing files | [Atlas 04](02-atlas/04-files-and-paths.md) | `engine/build.js` |
| command-line programs | [Atlas 05](02-atlas/05-cli-arguments.md) | `engine/build.js`, `engine/serve.js` |
| web servers, HTTP | [Atlas 06](02-atlas/06-http-server.md) | `engine/serve.js` |
| the DOM, events | [Atlas 07](02-atlas/07-dom-and-events.md) | `engine/ui/overlay.js`, `engine/ui/ui.js` |
| HTML forms | [Atlas 08](02-atlas/08-forms-and-honeypot.md) | `engine/blocks/contact-form.js` |
| images on the web | [Atlas 09](02-atlas/09-images.md) | `engine/lib/owner.js` (`prepareUpload`) |
| try/catch, exceptions | [Atlas 10](02-atlas/10-error-handling.md) | `engine/apply-patch.js`, `engine/lib/owner.js` |
| git | [Atlas 11](02-atlas/11-git-automation.md) | `engine/lib/owner.js` (`runPublish`, `restore`) |
| testing | [Atlas 12](02-atlas/12-testing-proofs.md) | `engine/_run-proofs.js` |
| "validate user input" | [Atlas 13](02-atlas/13-security-mindset.md) | `engine/lib/patch.js`, `engine/serve.js`, `engine/lib/escape.js` |
| functions calling functions | [Trace A](03-traces/trace-a-build.md) | `engine/build.js` → `engine/lib/render.js` → `engine/blocks/*` |
| client–server round trips | [Trace B](03-traces/trace-b-owner-edit.md) | `engine/ui/ui.js` → `engine/serve.js` → `engine/lib/owner.js` |

## Glossary

Terms are also defined where they first appear; this is the quick lookup.

- **static site** — pages prebuilt as plain HTML files, identical for
  every visitor; no server-side code at view time.
- **schema** — a machine-checkable description of a data shape; here a
  JSON Schema file enforced by the **ajv** library.
- **block** — one section of a page (`hero`, `faq`, …): a `type` that
  selects a renderer plus `fields` that feed it.
- **patch** — a small JSON instruction (`set` / `append` / `delete` /
  `set-token` / `refuse`) — the only language for content changes.
- **resolver** — `applyPatch` in `engine/lib/patch.js`; the single
  chokepoint enforcing the write allowlist.
- **allowlist / blocklist** — permit-only-what's-listed versus
  forbid-only-what's-listed; the first fails safe.
- **candidate** — the editor's full working copy of a client
  (`clients/<name>__candidate/`); the preview is a real build of it.
- **pending / staged / live** — the one change just made; the changes
  kept for this session; the real site source that only Publish writes.
- **annotated build** — preview-only build stamped with `data-bk-*`
  attributes marking editable elements; live builds never contain them.
- **edit map** — the machine-readable list of everything editable
  (`buildEditMap` in `engine/lib/sitemap.js`); both the UI's clickable
  surface and the annotator derive from it.
- **blueprint** — a developer-authored JSON template (page, block, or
  repeating item) that owners can instantiate through a validated form.
- **idempotent** — safe to run twice; the second run changes nothing
  (e.g. the migration script proof 17 mentions).
- **loopback** — `127.0.0.1`, the this-machine-only network address.
- **honeypot** — an invisible form field only bots fill; submissions
  carrying it are dropped.
- **magic bytes** — the fixed leading bytes identifying a file format;
  checked so upload contents must match their name.
- **XSS** — cross-site scripting: untrusted text executing as script
  because it was rendered as markup; prevented here by `esc()` and
  `textContent`-only rendering.
- **child process** — a program your program runs (`spawnSync`); how the
  engine drives git and itself.
- **e2e / end-to-end test** — a test through real interfaces (CLI, HTTP,
  git) rather than internal calls; the proof suite's whole approach.
- **JSONL** — one JSON document per line; the maintenance ledger's
  format.
- **candidate build / acceptance gate** — every change must survive a
  full build of the candidate copy before it can even become pending.
