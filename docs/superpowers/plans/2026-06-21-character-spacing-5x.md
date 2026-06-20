# Wider character spacing (5×) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase mind-map character spacing from 3× to 5× and make existing hand-placed maps spread out too, by scaling saved positions at render time.

**Architecture:** A new shared constants module (`web/src/lib/layout.ts`) holds the spacing knob (`SPACING_FACTOR = 5`) and a `POSITION_SCALE = 5/3`. Stored `posX`/`posY` stay in the original "3× logical" space; `graphAdapter.toElements` multiplies them by `POSITION_SCALE` on load and `MindMap.tsx` divides drag positions by it before persisting — a clean round-trip with no DB migration.

**Tech Stack:** React 18 + TypeScript, Cytoscape.js (`cola` layout), Vitest.

## Global Constraints

- Use Serena MCP tools for file navigation/editing where practical; the exact edits below are small and explicit.
- Stored coordinates must remain in the original 3× logical space — never migrate the DB.
- `LAYOUT_BASELINE = 3` is a fixed historical constant and must never change; `SPACING_FACTOR` is the only live spacing knob.
- ESM import paths in `web/` use the `.js` extension even for `.ts` sources (e.g. `../lib/layout.js`).
- Run the **full** web test suite (`npm run test --workspace web`) before declaring done, plus `npx tsc --noEmit -p web/tsconfig.json` (Vitest's esbuild skips type errors the Docker build catches).

---

### Task 1: Shared layout constants + scaled position load

**Files:**
- Create: `web/src/lib/layout.ts`
- Modify: `web/src/lib/graphAdapter.ts:24` (the saved-position branch) and its import block
- Test: `web/src/lib/__tests__/graphAdapter.test.ts`

**Interfaces:**
- Produces (`web/src/lib/layout.ts`):
  - `export const SPACING_FACTOR = 5`
  - `export const LAYOUT_BASELINE = 3`
  - `export const POSITION_SCALE: number` (= `SPACING_FACTOR / LAYOUT_BASELINE`, ≈ 1.667)
  - `export const BASE_EDGE_LENGTH = 50`
  - `export const BASE_NODE_SPACING = 10`
- `toElements(graph: BookGraph): CyElement[]` — unchanged signature; positioned nodes now carry `position = { x: posX * POSITION_SCALE, y: posY * POSITION_SCALE }`.

- [ ] **Step 1: Create the shared constants module**

Create `web/src/lib/layout.ts`:

```ts
// Spacing applies to auto-layout only; stored posX/posY live in the original
// LAYOUT_BASELINE (3×) space and are scaled to display by POSITION_SCALE.
export const SPACING_FACTOR = 5;
export const LAYOUT_BASELINE = 3;
export const POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE; // = 5/3 ≈ 1.667
export const BASE_EDGE_LENGTH = 50;
export const BASE_NODE_SPACING = 10;
```

- [ ] **Step 2: Update the failing test for the scaled position**

In `web/src/lib/__tests__/graphAdapter.test.ts`, add the import after line 2:

```ts
import { POSITION_SCALE } from "../layout.js";
```

Replace line 19:

```ts
  expect(vNode.position).toEqual({ x: 10, y: 20 });
```

with:

```ts
  expect(vNode.position).toEqual({ x: 10 * POSITION_SCALE, y: 20 * POSITION_SCALE });
```

(The "nodes without saved position" and "posX set but posY null" tests stay as-is — they verify scaling did not change null handling.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — "maps nodes with label, avatar key and saved position" expects `{ x: 16.66…, y: 33.33… }` but `toElements` still returns `{ x: 10, y: 20 }`.

- [ ] **Step 4: Scale the position in graphAdapter**

In `web/src/lib/graphAdapter.ts`, add to the import block near the top (alongside the existing imports):

```ts
import { POSITION_SCALE } from "./layout.js";
```

Replace line 24:

```ts
    if (c.posX != null && c.posY != null) el.position = { x: c.posX, y: c.posY };
```

with:

```ts
    if (c.posX != null && c.posY != null)
      el.position = { x: c.posX * POSITION_SCALE, y: c.posY * POSITION_SCALE };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS (all tests in the file green).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/layout.ts web/src/lib/graphAdapter.ts web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): scale saved node positions by POSITION_SCALE on load

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire the canvas to the shared constants and persist in logical space

**Files:**
- Modify: `web/src/canvas/MindMap.tsx` (constants block lines 10-13, the `dragfree` handler ~line 82-85, and the layout `edgeLength`/`nodeSpacing` reference the imported constants)

**Interfaces:**
- Consumes from `web/src/lib/layout.js`: `SPACING_FACTOR`, `BASE_EDGE_LENGTH`, `BASE_NODE_SPACING`, `POSITION_SCALE`.
- No exported interface change; `onNodeMoved(id, x, y)` now receives **logical** (un-scaled) coordinates.

- [ ] **Step 1: Replace the local constants with the shared import**

In `web/src/canvas/MindMap.tsx`, delete the local declarations (lines 10-13):

```ts
// Spacing applies to auto-layout only; saved posX/posY are not scaled.
const SPACING_FACTOR = 3;
const BASE_EDGE_LENGTH = 50;
const BASE_NODE_SPACING = 10;
```

Add to the import block at the top (after the existing imports):

```ts
import { SPACING_FACTOR, BASE_EDGE_LENGTH, BASE_NODE_SPACING, POSITION_SCALE } from "../lib/layout.js";
```

The layout config keeps `edgeLength: BASE_EDGE_LENGTH * SPACING_FACTOR` and `nodeSpacing: BASE_NODE_SPACING * SPACING_FACTOR` unchanged — they now resolve to 250 / 50.

- [ ] **Step 2: Persist drag positions in logical space**

Replace the `dragfree` handler body (currently lines ~82-85):

```ts
    cy.on("dragfree", "node", (evt) => {
      const p = evt.target.position();
      onNodeMoved(evt.target.id(), p.x, p.y);
    });
```

with (divide by `POSITION_SCALE` so storage stays in the 3× logical space that `toElements` scales back up):

```ts
    cy.on("dragfree", "node", (evt) => {
      const p = evt.target.position();
      // Persist in logical space (graphAdapter scales by POSITION_SCALE on load).
      onNodeMoved(evt.target.id(), p.x / POSITION_SCALE, p.y / POSITION_SCALE);
    });
```

- [ ] **Step 3: Type-check the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors (no unused/duplicate `SPACING_FACTOR`, all imports resolve).

- [ ] **Step 4: Run the full web test suite**

Run: `npm run test --workspace web`
Expected: PASS — all web tests green, including the updated `graphAdapter` test.

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/MindMap.tsx
git commit -m "feat(web): widen canvas spacing to 5x and persist drags in logical space

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Update documentation gotchas

**Files:**
- Modify: `CLAUDE.md` (the "Canvas layout spacing" gotcha)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the spacing gotcha**

In `CLAUDE.md`, replace the "Canvas layout spacing" bullet:

```
- **Canvas layout spacing** — `MindMap.tsx` passes explicit `edgeLength`/`nodeSpacing` (base × `SPACING_FACTOR = 3`) to the cola layout. This affects *auto-layout only*; saved `posX`/`posY` are never scaled, so hand-placed maps keep their positions.
```

with:

```
- **Canvas layout spacing** — spacing constants live in `web/src/lib/layout.ts`. `MindMap.tsx` passes `edgeLength`/`nodeSpacing` (base × `SPACING_FACTOR = 5`) to the cola layout. Stored `posX`/`posY` live in the original `LAYOUT_BASELINE = 3` logical space; `graphAdapter.toElements` multiplies them by `POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE` (5/3) on load and `MindMap`'s `dragfree` handler divides by it before persisting. So existing hand-placed maps spread out with the factor too — keep the load/save scaling symmetric or positions drift on every drag.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document POSITION_SCALE and the 5x spacing model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- New `web/src/lib/layout.ts` with all five constants → Task 1, Step 1. ✓
- `graphAdapter` scales saved position by `POSITION_SCALE` → Task 1, Step 4. ✓
- Null / partial-position handling unchanged → Task 1, Step 2 (existing tests retained). ✓
- `MindMap` imports constants, drops locals, `edgeLength`/`nodeSpacing` use `SPACING_FACTOR = 5` → Task 2, Step 1. ✓
- `dragfree` divides by `POSITION_SCALE` → Task 2, Step 2. ✓
- Test update to scaled expectation → Task 1, Step 2. ✓
- Out of scope (no DB migration, no API change) → respected; no such tasks. ✓
- Docs gotcha (spec implies the CLAUDE.md note is now stale) → Task 3. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows exact code. ✓

**Type consistency:** `POSITION_SCALE`, `SPACING_FACTOR`, `BASE_EDGE_LENGTH`, `BASE_NODE_SPACING`, `LAYOUT_BASELINE` named identically across Tasks 1–2 and the import paths use the `.js` extension consistently. `onNodeMoved(id, x, y)` signature unchanged; only the coordinate space of its arguments changes. ✓
