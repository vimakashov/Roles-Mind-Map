# Wider character spacing (5×) — design

## Goal

Increase the spacing between characters on the mind-map canvas from the current
3× to 5×, and make **existing hand-placed maps spread out too** — not just
fresh auto-layouts.

## Background

`web/src/canvas/MindMap.tsx` drives a Cytoscape `cola` layout. Spacing is set by
`SPACING_FACTOR = 3`, applied as `edgeLength = BASE_EDGE_LENGTH (50) * SPACING_FACTOR`
and `nodeSpacing = BASE_NODE_SPACING (10) * SPACING_FACTOR`.

This factor governs **auto-layout only**. Saved `posX`/`posY` are loaded verbatim
by `graphAdapter.toElements`, so bumping the factor alone does **not** spread maps
that already have hand-placed positions. To spread existing maps, the saved
coordinates must be actively scaled.

## Approach — live render-time position scale

Chosen over a one-time DB migration because it needs no data surgery, is fully
reversible, and keeps spacing as a single tunable knob.

**Coordinate model:** stored `posX`/`posY` remain in the original "3× logical"
space, so existing and future data share one coordinate space (no migration).
The canvas *displays* positions multiplied by `POSITION_SCALE` and *persists*
drags divided by it — a clean round-trip.

- `POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE = 5 / 3 ≈ 1.667`
- `LAYOUT_BASELINE = 3` is a fixed historical constant: the factor the stored
  coordinates are expressed in. It never changes. `SPACING_FACTOR` is the live knob.

Existing maps (saved in 3×-logical units) render at ×5/3 → appear at 5× spacing,
matching the new auto-layout `edgeLength` (250) so the infinite `cola` layout
stays near equilibrium instead of fighting the placed positions. New books
auto-layout at 5× directly; dragging them round-trips through the same scale.

## Changes

### New shared module `web/src/lib/layout.ts`

Single source of truth shared by the canvas and the adapter:

```ts
export const SPACING_FACTOR = 5;          // was 3 — auto-layout spacing knob
export const LAYOUT_BASELINE = 3;         // fixed: stored coords live in the original 3× space
export const POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE;  // = 5/3 ≈ 1.667
export const BASE_EDGE_LENGTH = 50;
export const BASE_NODE_SPACING = 10;
```

Placed in `lib/` (not `canvas/`) so the dependency direction stays clean:
`graphAdapter.ts` (a `lib/` module) imports a `lib/` sibling, and `MindMap.tsx`
(a `canvas/` module) imports from `lib/`.

### `web/src/lib/graphAdapter.ts`

On load, scale the saved position:

```ts
if (c.posX != null && c.posY != null)
  el.position = { x: c.posX * POSITION_SCALE, y: c.posY * POSITION_SCALE };
```

Null / partial positions (only `posX` or only `posY`) keep their existing
behaviour: no `position` field.

### `web/src/canvas/MindMap.tsx`

- Remove the local `SPACING_FACTOR`, `BASE_EDGE_LENGTH`, `BASE_NODE_SPACING`
  constants; import them from `../lib/layout.js` along with `POSITION_SCALE`.
- `edgeLength`/`nodeSpacing` keep using `* SPACING_FACTOR` (now 5).
- In the `dragfree` handler, divide before persisting so storage stays in
  logical space:

  ```ts
  onNodeMoved(evt.target.id(), p.x / POSITION_SCALE, p.y / POSITION_SCALE);
  ```

The in-place sync effect (`toElements` consumed for `data` only) is unaffected —
it never applies `position`, so scaling does not disturb live nodes on edits.

## Tests

- Update `web/src/lib/__tests__/graphAdapter.test.ts` "maps nodes with label,
  avatar key and saved position": expect the scaled position
  `{ x: 10 * POSITION_SCALE, y: 20 * POSITION_SCALE }` (import `POSITION_SCALE`
  rather than hard-coding the float).
- Keep the existing assertions that nodes without a saved position (and nodes
  with only `posX` or only `posY`) have no `position` field — verifies scaling
  did not change the null-handling.
- The `dragfree` division has no existing unit test (there is no Cytoscape test
  harness for `MindMap`); it is covered indirectly by the adapter's inverse test
  plus a code comment. No new test rig is introduced.

## Out of scope

- No DB migration.
- No API / server changes.
- No change to how unpositioned nodes are laid out beyond the factor bump.
