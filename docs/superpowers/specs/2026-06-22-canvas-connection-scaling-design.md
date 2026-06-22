# Canvas connection-based scaling — design

## Summary

Scale a character's avatar and name on the mind-map canvas by how many
relationships it has, and push its neighbours proportionally farther away. The
more connections a character has, the larger its node (avatar + name font) and
the longer its incident edges. The effect is purely visual and entirely
client-side — no server, schema, or API change.

## Motivation

Today every node on the canvas is the same size (`46×46`, font `11`) and every
edge uses the same preferred length, so a highly-connected "hub" character looks
identical to an isolated one. Scaling by degree makes the important, well-
connected characters visually prominent and spreads their neighbourhood out so
the hub is legible.

## Scaling rules

Let `N` = a character's **degree** = the number of relationships incident to it.
Because the schema stores exactly one `Relationship` row per unordered pair,
`N` equals the number of distinct related characters (count of incident edges).

- **Size multiplier:** `scale = min(1 + 0.5 × N, MAX_SCALE)`
  - `N = 0` → ×1.0 (isolated character, baseline)
  - `N = 1` → ×1.5
  - `N = 2` → ×2.0
  - `N = 3` → ×2.5
  - `N ≥ 4` → ×3.0 (capped)
- **Cap:** `MAX_SCALE = 3.0` (reached at 4 relationships). Prevents a hub from
  dominating / overflowing the canvas.

## Affected files

Three client files only:

- `web/src/lib/layout.ts` — new constants.
- `web/src/lib/graphAdapter.ts` — compute degree → `scale`, emit it in node data.
- `web/src/canvas/MindMap.tsx` — consume `scale` for node size, name font, and
  per-edge length.

## Component design

### 1. `layout.ts` — constants (single source of truth)

Add:

- `SCALE_PER_EDGE = 0.5`
- `MAX_SCALE = 3.0`
- `BASE_NODE_SIZE = 46` (lifted from the `MindMap` literal)
- `BASE_FONT_SIZE = 11` (lifted from the `MindMap` literal)

### 2. `graphAdapter.toElements` — degree → `scale`

- Before mapping nodes, build a degree map: iterate `graph.edges`, incrementing a
  count for both `sourceId` and `targetId`.
- For each node, compute `scale = Math.min(1 + SCALE_PER_EDGE × degree, MAX_SCALE)`
  (degree defaults to `0` for a node with no edges).
- Emit `scale` as a new field on the node `data` object. No other adapter change;
  edges are unchanged.

### 3. `MindMap.tsx` — consume `scale`

Node style (replace the fixed literals with Cytoscape mapping functions, mirroring
the existing `background-color`/`background-image` function style):

- `width` → `(ele) => BASE_NODE_SIZE * ele.data("scale")`
- `height` → `(ele) => BASE_NODE_SIZE * ele.data("scale")`
- `font-size` → `(ele) => BASE_FONT_SIZE * ele.data("scale")`

Unchanged: `border-width` (2), text-background padding/shape, colours. The avatar
image fills the node via `background-fit: cover`, so it scales with width/height
automatically.

cola layout — `edgeLength` becomes a function of the edge:

- `(edge) => BASE_EDGE_LENGTH * SPACING_FACTOR * Math.max(edge.source().data("scale"), edge.target().data("scale"))`

A hub therefore pushes **every** neighbour out by its own (larger) factor. cola's
built-in overlap avoidance reads the now-larger node bounding boxes, so big nodes
also gain proportionate spacing without touching `nodeSpacing`.

## Re-layout behaviour

- Adding or removing a relationship changes the **edge id-set**, which already
  triggers `MindMap`'s full re-init + cola re-run (per the existing init effect's
  dependency on the joined edge ids). Scales and edge lengths recompute and the
  map re-flows — exactly the desired behaviour.
- Attribute-only edits (name, gender, avatar, role, colour) do **not** change any
  degree, so the existing in-place `data()` sync path is unaffected; it spreads
  `data` including `scale`, harmlessly re-writing the same value.

## Testing

- **`graphAdapter` unit test:** assert the degree→`scale` mapping and the cap —
  e.g. nodes with 0 / 1 / 4 / 6 incident edges yield `scale` of 1.0 / 1.5 / 3.0 /
  3.0 respectively.
- **`MindMap.test.tsx`** (already forces Cytoscape's null renderer): assert a
  node's resolved `width` and `font-size` reflect its `scale`, and that the cola
  `edgeLength` is configured as a function (or assert the resolved length on a
  known edge between a hub and a leaf).

## Out of scope / YAGNI

- No server, schema, API, or persistence change.
- No user-configurable cap or per-book toggle — fixed constants.
- No change to `nodeSpacing`, border, or text-background styling.
- No animation of the size transition beyond cola's existing layout animation.
