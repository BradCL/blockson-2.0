# Layout vNext Design Note

**Status:** future design note, not the current Blockson contract.

This note captures a deferred architecture idea: whether Blockson should support
owner-safe page rearrangement, and if so, how to do it without weakening the
maintenance-tier safety model.

## Current Safety Boundary

Today, the maintenance tier is intentionally narrow. Owners and model-assisted
flows edit developer-seeded values through deterministic commands, then the
candidate build proves the result before anything reaches the live site.

The important safety properties are:

- Edits address stable ids, never array indices.
- Structural identity fields (`id`, `type`, `slug`) are not writable.
- Object and array containers cannot be replaced by ordinary patches.
- Ordinary patches edit existing fields; they do not invent new structure.
- The few creation paths are explicit and guarded: safe theme tokens,
  flat-list append, item/page/block blueprints, item removal, and the narrow
  owner-creatable page-header fields.
- Structural changes go through dedicated paths, not plain scalar writes.

This boundary is the reason the current editor can be useful without becoming a
freeform page builder.

## Initial Grid Idea

The proposed feature was a fixed `N x M` grid behind each page:

- Every block has a `gridPosition`.
- A block may also have a footprint/span.
- Rearrangement is never freeform movement.
- A valid rearrangement swaps `gridPosition` values between two blocks.
- Swaps are valid only when the two blocks have matching footprints.
- The grid occupancy invariant is preserved before and after every accepted
  change.

This is safer than drag-anywhere placement, but it still changes the current
contract: owners would be able to reorder existing page sections, which is
currently developer work.

## Recommendation

Do not expose raw `gridPosition` as an ordinary addressable scalar field.

The invariant is relational, not local. A normal `set` patch validates one
address and one value, but grid safety depends on the whole page:

- Both blocks must exist.
- Both blocks must be on the same page/grid.
- Both positions or slots must already exist.
- Both positions must be occupied before the change.
- The footprints must be compatible.
- The result must not duplicate positions or create an empty/colliding slot.
- The operation must be atomic; there should be no invalid intermediate state.

If this is added to the current engine, it should be a dedicated structural
operation, similar in spirit to item add/remove:

```json
{
  "action": "swap-grid-position",
  "page": "index",
  "a": "home-services",
  "b": "home-testimonials"
}
```

The resolver or owner handler should validate the page occupancy invariant
before mutating and then swap both assignments in one operation.

## Better vNext Shape: Semantic Slots

If this becomes a larger vNext effort, a semantic layout model is preferable to
raw row/column coordinates.

Instead of storing editable coordinates on blocks, define developer-authored
layout templates with named slots:

```json
{
  "layout": "home-standard-v1",
  "slots": {
    "hero": {
      "accepts": ["hero"],
      "size": "full-bleed"
    },
    "primary": {
      "accepts": ["text", "card-grid", "gallery"],
      "size": "wide"
    },
    "secondary": {
      "accepts": ["testimonials", "cta"],
      "size": "narrow"
    }
  },
  "placements": {
    "hero": "home-hero",
    "primary": "home-services",
    "secondary": "home-testimonials"
  }
}
```

Owner rearrangement then becomes "swap compatible slot placements", not "write
coordinates". CSS grid can still be the renderer, but it is an output detail of a
validated layout template.

This model gives more room to grow:

- Responsive desktop/mobile slot definitions.
- Compatibility rules by block type, block family, or slot size.
- Safer drag-to-swap UI.
- Page templates shared across clients.
- Layout-specific proof fixtures.
- Future "replace this slot with another compatible block" commands.

## Suggested vNext Architecture

A larger rebuild should keep the current project's best idea: all changes are
typed commands with validators, not arbitrary mutations.

Potential command families:

- `setScalar`
- `setThemeToken`
- `uploadAssetAndSetField`
- `instantiateBlueprint`
- `removeItem`
- `hideBlock`
- `showBlock`
- `swapSlots`
- `replaceSlotBlock`

The domain model could be normalized into pages, blocks, items, assets, themes,
and layouts rather than relying on one nested `content.json` object for every
concern. The renderer can stay static HTML at first; the durable part should be
the validated content/layout model and replayable command log.

## Risks and Tradeoffs

Layout editing introduces risks that ordinary text and image maintenance mostly
avoids:

- **Current-contract change:** owners would gain a constrained form of
  reordering, which is currently developer-only.
- **Text overflow:** fixed slots can make a previously safe copy edit clip,
  overflow, or overlap.
- **Mobile order:** visual grid order and DOM order can diverge, harming keyboard
  and screen-reader navigation. A safe system should render DOM in the accepted
  layout order or explicitly validate reading order.
- **Hidden blocks:** the current live build omits hidden blocks. A grid layout
  needs a deliberate rule for whether hidden blocks reserve their slots.
- **Blueprints:** new page/block/item scaffolding would need slot assignment and
  compatibility metadata.
- **Renderer assumptions:** existing blocks often assume vertical, full-width
  page flow. Many would need audits before being placed in narrow or fixed
  regions.
- **Semantic mismatch:** two blocks can have the same footprint but be a poor
  design swap. Compatibility groups should be semantic, not just geometric.
- **Proof gap:** schema/build success alone would not prove layout quality. The
  proof suite would need browser checks for overflow, collisions, annotation
  coverage, mobile behavior, and replay/publish consistency.

## Practical Path

For now, do not add this to the current editor while client work is still focused
on the basics.

If revisited later, the lowest-risk path is:

1. Prototype semantic slots on one demo client only.
2. Add a shared layout validator with strict invariant checks.
3. Add one structural command: swap two compatible occupied slots.
4. Keep raw coordinates out of the ordinary patch surface.
5. Prove candidate replay, publish, invalid swaps, hidden blocks, and mobile DOM
   order.
6. Only then consider exposing the interaction in the owner UI.

The goal is not to become a full page builder. The goal is to preserve Blockson's
core promise: useful owner control inside a small, safe, developer-defined
design space.
