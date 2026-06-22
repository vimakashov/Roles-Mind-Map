# Canvas Connection-Based Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale each character's avatar + name and its edge lengths on the mind-map canvas by how many relationships it has.

**Architecture:** Purely client-side, purely visual. A pure helper in `layout.ts` maps a node's degree → size multiplier; `graphAdapter` counts incident edges per character and emits a `scale` field in node data; `MindMap` consumes `scale` for node width/height, name font-size, and a per-edge cola `edgeLength` (averaged across the two endpoints). No server, schema, or API change.

**Tech Stack:** TypeScript, React 18, Cytoscape.js + cytoscape-cola, Vitest, Testing Library.

## Global Constraints

- Size multiplier: `scale = min(1 + 0.5 × degree, 3.0)` — `SCALE_PER_EDGE = 0.5`, `MAX_SCALE = 3.0`.
- Base node size `46`, base font `11` (today's literals, lifted into `layout.ts`).
- Edge length uses the **average** of the two endpoints' scales: `BASE_EDGE_LENGTH * SPACING_FACTOR * (sA + sB) / 2` (`BASE_EDGE_LENGTH = 50`, `SPACING_FACTOR = 5`, already in `layout.ts`).
- Degree = number of incident edges (one `Relationship` row per unordered pair = one edge per related character).
- No server/schema/API/persistence change; no `nodeSpacing`/border/text-background change; no user-configurable cap.
- Run web tests with: `npm run test --workspace web -- <pattern>`.

---

### Task 1: Scaling helpers + constants in `layout.ts`

**Files:**
- Modify: `web/src/lib/layout.ts`
- Test: `web/src/lib/__tests__/layout.test.ts` (create)

**Interfaces:**
- Consumes: existing `BASE_EDGE_LENGTH`, `SPACING_FACTOR` from `layout.ts`.
- Produces:
  - `SCALE_PER_EDGE: number` (= `0.5`)
  - `MAX_SCALE: number` (= `3.0`)
  - `BASE_NODE_SIZE: number` (= `46`)
  - `BASE_FONT_SIZE: number` (= `11`)
  - `scaleForDegree(degree: number): number` → `Math.min(1 + SCALE_PER_EDGE * degree, MAX_SCALE)`
  - `edgeLengthForScales(scaleA: number, scaleB: number): number` → `BASE_EDGE_LENGTH * SPACING_FACTOR * (scaleA + scaleB) / 2`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/layout.test.ts`:

```ts
import { expect, test } from "vitest";
import { scaleForDegree, edgeLengthForScales } from "../layout.js";

test("scaleForDegree grows by 0.5 per edge from a baseline of 1.0", () => {
  expect(scaleForDegree(0)).toBe(1.0);
  expect(scaleForDegree(1)).toBe(1.5);
  expect(scaleForDegree(2)).toBe(2.0);
  expect(scaleForDegree(3)).toBe(2.5);
});

test("scaleForDegree caps at 3.0 (reached at 4 edges)", () => {
  expect(scaleForDegree(4)).toBe(3.0);
  expect(scaleForDegree(6)).toBe(3.0);
  expect(scaleForDegree(20)).toBe(3.0);
});

test("edgeLengthForScales averages the two endpoint scales over the base length", () => {
  // base = BASE_EDGE_LENGTH(50) * SPACING_FACTOR(5) = 250
  expect(edgeLengthForScales(1, 1)).toBe(250);
  expect(edgeLengthForScales(1.5, 1.5)).toBe(375);
  expect(edgeLengthForScales(3.0, 1.5)).toBe(562.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- layout`
Expected: FAIL — `scaleForDegree`/`edgeLengthForScales` are not exported.

- [ ] **Step 3: Write minimal implementation**

`web/src/lib/layout.ts` currently is:

```ts
// Spacing applies to auto-layout only; stored posX/posY live in the original
// LAYOUT_BASELINE (3×) space and are scaled to display by POSITION_SCALE.
export const SPACING_FACTOR = 5;
export const LAYOUT_BASELINE = 3;
export const POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE; // = 5/3 ≈ 1.667
export const BASE_EDGE_LENGTH = 50;
export const BASE_NODE_SPACING = 10;
```

Append to the end of the file:

```ts

// Connection-based scaling: a character's node grows with its number of
// relationships (degree). scale = 1 + 0.5·degree, capped at MAX_SCALE.
export const SCALE_PER_EDGE = 0.5;
export const MAX_SCALE = 3.0;
export const BASE_NODE_SIZE = 46;
export const BASE_FONT_SIZE = 11;

export function scaleForDegree(degree: number): number {
  return Math.min(1 + SCALE_PER_EDGE * degree, MAX_SCALE);
}

// Preferred cola edge length: base distance scaled by the average of the two
// endpoints' scales (softer than max — keeps a hub's neighbourhood compact).
export function edgeLengthForScales(scaleA: number, scaleB: number): number {
  return (BASE_EDGE_LENGTH * SPACING_FACTOR * (scaleA + scaleB)) / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- layout`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/layout.ts web/src/lib/__tests__/layout.test.ts
git commit -m "feat(web): add degree→scale and edge-length helpers"
```

---

### Task 2: Emit per-node `scale` from `graphAdapter`

**Files:**
- Modify: `web/src/lib/graphAdapter.ts`
- Test: `web/src/lib/__tests__/graphAdapter.test.ts:1` (add tests)

**Interfaces:**
- Consumes: `scaleForDegree(degree)` from Task 1.
- Produces: each node element's `data.scale: number` (degree counted from `graph.edges`; `0` when a node has no incident edges).

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/__tests__/graphAdapter.test.ts`:

```ts
test("emits a per-node scale from its degree, capped, default 1.0 when isolated", () => {
  // hub h ↔ a,b,c,d (degree 4 → capped 3.0); each leaf degree 1 → 1.5; lone z → 1.0
  const g: BookGraph = {
    nodes: [
      { id: "h", bookId: "b", gender: "female", firstName: "Анна" },
      { id: "a", bookId: "b", gender: "male", firstName: "А" },
      { id: "c2", bookId: "b", gender: "male", firstName: "Б" },
      { id: "c3", bookId: "b", gender: "male", firstName: "В" },
      { id: "c4", bookId: "b", gender: "male", firstName: "Г" },
      { id: "z", bookId: "b", gender: "male", firstName: "Один" },
    ],
    edges: [
      { id: "e1", bookId: "b", sourceId: "h", targetId: "a", role: "" },
      { id: "e2", bookId: "b", sourceId: "h", targetId: "c2", role: "" },
      { id: "e3", bookId: "b", sourceId: "h", targetId: "c3", role: "" },
      { id: "e4", bookId: "b", sourceId: "h", targetId: "c4", role: "" },
    ],
  };
  const els = toElements(g);
  const scaleOf = (id: string) => els.find((e) => e.data.id === id)!.data.scale;
  expect(scaleOf("h")).toBe(3.0);
  expect(scaleOf("a")).toBe(1.5);
  expect(scaleOf("z")).toBe(1.0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — `data.scale` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/lib/graphAdapter.ts`, add `scaleForDegree` to the layout import:

```ts
import { POSITION_SCALE, scaleForDegree } from "./layout.js";
```

Inside `toElements`, build the degree map at the top of the function (before `const nodes = ...`):

```ts
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }
```

Then add `scale` to each node's `data` object (alongside `gender`):

```ts
        gender: c.gender,
        scale: scaleForDegree(degree.get(c.id) ?? 0),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/graphAdapter.ts web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): emit per-node scale from relationship degree"
```

---

### Task 3: Consume `scale` in `MindMap` (node size, font, edge length)

**Files:**
- Modify: `web/src/canvas/MindMap.tsx`
- Test: `web/src/canvas/__tests__/MindMap.test.tsx:1` (add a test)

**Interfaces:**
- Consumes: node `data.scale` (Task 2); `BASE_NODE_SIZE`, `BASE_FONT_SIZE`, `edgeLengthForScales` (Task 1).
- Produces: no new exports — visual styling only.

- [ ] **Step 1: Write the failing test**

Append to `web/src/canvas/__tests__/MindMap.test.tsx`:

```ts
test("scales node width and name font-size by the node's scale", () => {
  // hub c1 ↔ c2,c3,c4,c5 → degree 4 → scale 3.0; leaf c2 → degree 1 → scale 1.5
  const graph: BookGraph = {
    nodes: [
      { id: "c1", bookId: "b1", gender: "female", firstName: "Анна" },
      { id: "c2", bookId: "b1", gender: "male", firstName: "А" },
      { id: "c3", bookId: "b1", gender: "male", firstName: "Б" },
      { id: "c4", bookId: "b1", gender: "male", firstName: "В" },
      { id: "c5", bookId: "b1", gender: "male", firstName: "Г" },
    ],
    edges: [
      { id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "", color: null },
      { id: "e2", bookId: "b1", sourceId: "c1", targetId: "c3", role: "", color: null },
      { id: "e3", bookId: "b1", sourceId: "c1", targetId: "c4", role: "", color: null },
      { id: "e4", bookId: "b1", sourceId: "c1", targetId: "c5", role: "", color: null },
    ],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} />);
  const cy = instances[0];
  const hub = cy.getElementById("c1");
  const leaf = cy.getElementById("c2");
  expect(parseFloat(hub.style("width"))).toBe(46 * 3.0); // 138
  expect(parseFloat(hub.style("font-size"))).toBe(11 * 3.0); // 33
  expect(parseFloat(leaf.style("width"))).toBe(46 * 1.5); // 69
  expect(parseFloat(leaf.style("font-size"))).toBe(11 * 1.5); // 16.5
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- MindMap`
Expected: FAIL — `width` resolves to the fixed `46`, not `138`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/canvas/MindMap.tsx`, extend the layout import:

```ts
import {
  SPACING_FACTOR,
  BASE_EDGE_LENGTH,
  BASE_NODE_SPACING,
  POSITION_SCALE,
  BASE_NODE_SIZE,
  BASE_FONT_SIZE,
  edgeLengthForScales,
} from "../lib/layout.js";
```

In the `node` style block, replace the fixed `font-size`, `width`, and `height`:

Replace:

```ts
            "font-size": 11,
```
with:
```ts
            "font-size": (ele: any) => BASE_FONT_SIZE * ele.data("scale"),
```

Replace:

```ts
            width: 46,
            height: 46,
```
with:
```ts
            width: (ele: any) => BASE_NODE_SIZE * ele.data("scale"),
            height: (ele: any) => BASE_NODE_SIZE * ele.data("scale"),
```

In the `layout` config, replace the fixed `edgeLength`:

Replace:

```ts
        edgeLength: BASE_EDGE_LENGTH * SPACING_FACTOR,
```
with:
```ts
        edgeLength: (edge: any) =>
          edgeLengthForScales(edge.source().data("scale"), edge.target().data("scale")),
```

(`BASE_EDGE_LENGTH` and `SPACING_FACTOR` remain imported — `BASE_EDGE_LENGTH` is now used only inside `edgeLengthForScales`, but `nodeSpacing` still uses `BASE_NODE_SPACING * SPACING_FACTOR`, so keep `SPACING_FACTOR`. Remove `BASE_EDGE_LENGTH` from the import only if your linter flags it as unused; `nodeSpacing` is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- MindMap`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Verify the type-check is clean**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors (catches unused-import / type issues Vitest's esbuild skips).

- [ ] **Step 6: Run the full web suite**

Run: `npm run test --workspace web`
Expected: PASS — no regressions in graphAdapter/MindMap/other suites.

- [ ] **Step 7: Commit**

```bash
git add web/src/canvas/MindMap.tsx web/src/canvas/__tests__/MindMap.test.tsx
git commit -m "feat(web): scale node size, name font and edge length by connections"
```

---

## Notes for the implementer

- **Why no change to the in-place sync effect:** `MindMap`'s second effect spreads all mutable `data` fields (including the new `scale`) into existing elements, so an attribute-only edit harmlessly re-writes the same `scale`. Adding/removing a relationship changes the **edge id-set**, which triggers the full re-init + cola re-run, so scales and edge lengths recompute and the map re-flows. No code change is needed for either path.
- **Why a pure helper for edge length:** `edgeLengthForScales` lives in `layout.ts` so it is unit-tested directly (Task 1) without driving the cola layout in jsdom, and `MindMap`'s callback stays a one-liner.
