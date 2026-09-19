# Gallery owner-editor category follow-up

**Status:** optional future improvement; not required for current client builds.

## Why this note exists

A gallery's real categories live in its `fields.filters` array, but the shipped
`gallery-album` blueprint currently carries a separate, fixed list of category
options. Client-specific filters therefore require a developer to keep the
blueprint options synchronized manually. Hive Contracting exposed this gap when
its gallery gained categories such as Kitchens, Basements, Additions, and
Multi-Family Living.

The current behavior is safe and sufficient for developer-authored content:
developers can add filters and albums directly, and owners can add/remove photos
inside existing albums. This note is not a release blocker for Hive or any other
client.

## Possible future direction

When an owner invokes the add-album flow for a specific gallery, derive the
category choices from that gallery's current filters, excluding its default
`all` filter, instead of relying on the blueprint's global static options.

Keep the existing authority boundary intact:

- owners may choose among categories the developer already configured;
- adding, removing, reordering, or renaming category structure remains developer
  work unless a separate guarded design explicitly expands that authority;
- blueprint and full-content validation remain mandatory;
- a missing or malformed filter list must fail safely rather than inventing a
  category.

## Revisit trigger

Proceed when a client needs reliable self-service album creation across custom
gallery categories. Recheck `blueprints/gallery-album.json`, the item-blueprint
form generation and target context in `engine/ui/`, the scaffolder/owner handler
contract, gallery proofs, `BLOCK_CATALOG.md`, and `OPERATOR.md` before implementation.

