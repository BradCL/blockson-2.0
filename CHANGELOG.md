# Changelog

All notable changes to Blockson are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/): breaking
changes to the `content.json` schema, the patch contract, or theme tokens bump
the major version.

## [Unreleased]

Nothing yet.

## [2.0.0] — 2026-07-02

First public release. Blockson 2.0 is a ground-up rebuild of a private
predecessor; everything below is new in this line.

### Engine
- One engine, many client sites: each site is a single `content.json` plus an
  image folder, validated against a JSON schema (AJV, with a reduced built-in
  fallback validator when AJV is absent) and rendered to SEO-ready static HTML —
  sitemap, robots.txt, canonical/OpenGraph tags included.
- 23 block types across core and v2 sets, documented in `BLOCK_CATALOG.md`.
- Themes as token files (`themes/`), with authoring guides for themes and
  blueprints.

### Two-tier editing
- **Setup tier** (developer): full engine, block, theme, and blueprint control.
- **Maintenance tier** (owner): every write flows through `applyPatch`
  (`engine/lib/patch.js`), a deterministic allowlist resolver that makes unsafe
  edits unrepresentable — values, visibility, curated brand tokens, and
  developer-blessed blueprint instantiation only.
- Click-to-edit owner editor (`engine/serve.js`) with candidate preview,
  keep/discard sessions, one-button Publish with git-backed restore points,
  image upload with compression and thumbnails, and an optional on-device AI
  help assistant.
- No-install browser demo (`npm run build:demo`) running the same editor on an
  in-browser host.

### Trust mechanisms
- End-to-end proof suite (`npm test`) — every safety claim in `SPEC.md` is
  backed by a proof; the suite is the quality gate for every change.
- Browser smoke tests for the overlay, the editor keep-open flow, and the demo.
- CI across three Node versions.

### Handover
- Owner launcher app plus a single-executable runtime build (`npm run
  build:exe`) so an owner machine needs no Node install.
- Operator runbook (`OPERATOR.md`), handover kit (`docs/handover/`), learning
  guide, and captured developer/owner tutorials.

[Unreleased]: https://github.com/BradCL/blockson-2.0/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/BradCL/blockson-2.0/releases/tag/v2.0.0
