# Preserve Canvas Viewport on Character Add/Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the user's current zoom and pan on the mind-map canvas when a character/relation is created, edited, or deleted, instead of re-framing the whole graph.

**Architecture:** `MindMap` re-creates its Cytoscape instance whenever the node/edge id set changes. We snapshot the viewport (`pan`+`zoom`) in the effect cleanup before `cy.destroy()`, and on the next init restore it and skip the auto-fit-on-load. Auto-fit now runs only on the first mount of a book; cola is still free to re-layout. A `key={bookId}` on `<MindMap>` guarantees the snapshot can never leak across books.

**Tech Stack:** React 18 + TypeScript, Cytoscape.js (+ cytoscape-cola), Vitest + Testing Library, Vite.

## Global Constraints

- **MindMap tests must stay synchronous** — never `await` an animation frame; cola ticks in jsdom's null renderer would throw (`Cannot read properties of null`) after the test. (Project gotcha.)
- **Run `npx tsc --noEmit -p web/tsconfig.json`** after web edits — Vitest (esbuild) ignores type errors that the Docker/`npm run build` step catches.
- **No server/schema/API/`graphAdapter` changes** — this is a pure web-canvas fix.
- **Preserve viewport, allow re-layout** — only pan/zoom is held steady; cola may re-spread nodes (explicitly accepted).
- Single MindMap Cytoscape instance per mount; init effect re-runs only on node/edge **id-set** changes.

---

### Task 1: Preserve viewport across re-init in `MindMap`

**Files:**
- Modify: `web/src/canvas/MindMap.tsx`
- Test: `web/src/canvas/__tests__/MindMap.test.tsx`

**Interfaces:**
- Consumes: existing `MindMap` props (`graph`, `onNodeTap`, `onNodeMoved`, `onEdgeTap?`, `avatarUrl?`) — unchanged. Existing module-level constants `FIT_PADDING = 50`, `FIT_SETTLE_MS = 4000`.
- Produces: no new exports. Behavioral contract: on the **first mount** `cy.fit(undefined, FIT_PADDING)` runs (auto-fit machinery active); on **any subsequent re-init** (id-set change) the previous viewport is restored via `cy.viewport({ zoom, pan })` and `cy.fit` is **not** called.

- [ ] **Step 1: Write the failing test**

Add this test to `web/src/canvas/__tests__/MindMap.test.tsx` (append after the existing `"frames all characters on load by fitting the viewport"` test, matching the file's style):

```tsx
test("preserves the viewport (no refit) when the node id set changes", () => {
  const noop = vi.fn();
  const graphA: BookGraph = {
    nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "A", lastName: "X" }],
    edges: [],
  };
  const { rerender } = render(<MindMap graph={graphA} onNodeTap={noop} onNodeMoved={noop} />);

  const cy0 = instances[0];
  // Simulate the user having zoomed/panned to a spot before editing.
  cy0.zoom(2);
  cy0.pan({ x: 10, y: 20 });

  // Spy only now, so the first-mount fit isn't counted.
  const proto = Object.getPrototypeOf(cy0);
  const fitSpy = vi.spyOn(proto, "fit");
  const viewportSpy = vi.spyOn(proto, "viewport");

  // Add a second node → node id set changes → MindMap re-inits cytoscape.
  const graphB: BookGraph = {
    nodes: [
      ...graphA.nodes,
      { id: "c2", bookId: "b1", gender: "female", firstName: "B", lastName: "Y" },
    ],
    edges: [],
  };
  rerender(<MindMap graph={graphB} onNodeTap={noop} onNodeMoved={noop} />);

  // The re-init must restore the captured viewport and must NOT re-fit.
  expect(viewportSpy).toHaveBeenCalledWith({ zoom: 2, pan: { x: 10, y: 20 } });
  expect(fitSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- MindMap`
Expected: the new test FAILS — `viewportSpy` is never called (current code calls `cy.fit` on re-init instead of restoring the viewport), and likely `fitSpy` was called. The other MindMap tests still pass.

- [ ] **Step 3: Add the viewport snapshot ref**

In `web/src/canvas/MindMap.tsx`, just below the existing `onEdgeTapRef.current = onEdgeTap;` line (i.e. after the three callback refs are assigned), add:

```ts
  // Snapshot of the user's pan/zoom, captured on teardown so the next re-init
  // (triggered by a node/edge add/remove) can restore it instead of re-fitting.
  const viewportRef = useRef<{ pan: { x: number; y: number }; zoom: number } | null>(null);
```

- [ ] **Step 4: Branch init between first-mount auto-fit and re-init restore**

In the init effect, replace the entire current auto-fit block **and** the cleanup `return` with the version below. The current block to replace starts at the comment `// --- Frame all characters on load ---` and runs through the end of the `return () => { ... };` cleanup. Replace it with:

```ts
    // --- Viewport: fit on first load, otherwise keep the user where they are ---
    // cola's layout uses fit: false, so it never touches the viewport itself.
    let rafId = 0;
    let fitTimer = 0;
    if (viewportRef.current) {
      // Re-init (a node/edge was added or removed): restore the snapshot taken
      // on teardown and skip auto-fit, so the user stays at the same pan/zoom
      // while cola re-spreads the nodes underneath.
      cy.viewport({ zoom: viewportRef.current.zoom, pan: viewportRef.current.pan });
    } else {
      // First mount of this book: frame the whole graph. cola has no settle
      // event, so keep re-framing while it spreads the nodes out, then release
      // the viewport on the user's first gesture (or after a short cap).
      let autoFit = true;
      const fitNow = () => {
        rafId = 0;
        if (autoFit && !cy.destroyed()) cy.fit(undefined, FIT_PADDING);
      };
      const queueFit = () => {
        if (autoFit && !rafId) rafId = requestAnimationFrame(fitNow);
      };
      const stopAutoFit = () => {
        autoFit = false;
        if (!cy.destroyed()) cy.off("position", "node", queueFit);
      };
      cy.on("position", "node", queueFit); // re-frame as the layout spreads nodes
      cy.on("scrollzoom pinchzoom", stopAutoFit); // user zoom → hand over the viewport
      cy.one("tapstart", stopAutoFit); // user pan / drag / tap → hand over
      fitTimer = window.setTimeout(stopAutoFit, FIT_SETTLE_MS);
      fitNow(); // initial frame (synchronous; refits follow as the layout spreads)
    }

    return () => {
      // Capture the current viewport before teardown so the next re-init can
      // restore it (clone cy.pan() — it returns a live position object).
      viewportRef.current = { pan: { ...cy.pan() }, zoom: cy.zoom() };
      if (fitTimer) window.clearTimeout(fitTimer);
      if (rafId) cancelAnimationFrame(rafId);
      cy.destroy();
      cyRef.current = null;
    };
```

Leave everything else in the effect (the `cytoscape({...})` call, `cyRef.current = cy;`, and the three `cy.on(...)` handler bindings) and the effect dependency array unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace web -- MindMap`
Expected: all MindMap tests PASS, including the new `"preserves the viewport (no refit) when the node id set changes"` and the existing `"frames all characters on load by fitting the viewport"`.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/canvas/MindMap.tsx web/src/canvas/__tests__/MindMap.test.tsx
git commit -m "fix(web): keep canvas zoom/pan when characters change

Snapshot pan+zoom on teardown and restore it on re-init instead of
re-fitting, so adding/editing/deleting a character no longer throws the
user out of their current view. Auto-fit now runs only on first mount.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Scope the `MindMap` viewport snapshot per book

**Files:**
- Modify: `web/src/screens/BookScreen.tsx`

**Interfaces:**
- Consumes: `bookId` from `useParams()` (already in scope in `BookScreen`); the `<MindMap>` element rendered in the non-empty branch.
- Produces: `<MindMap key={bookId} ...>` — forces a fresh `MindMap` mount (and thus a discarded viewport snapshot + a fresh auto-fit) when the book changes, while keeping a single stable instance across graph mutations within one book.

- [ ] **Step 1: Add `key={bookId}` to the canvas**

In `web/src/screens/BookScreen.tsx`, find the `<MindMap` element inside the non-empty branch:

```tsx
          <MindMap
            graph={graph}
            onNodeTap={(id) => {
```

Add a `key` prop as the first attribute:

```tsx
          <MindMap
            key={bookId}
            graph={graph}
            onNodeTap={(id) => {
```

Leave all other props unchanged.

- [ ] **Step 2: Type-check and run the web test suite**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm run test --workspace web`
Expected: no type errors; all web tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/BookScreen.tsx
git commit -m "fix(web): remount MindMap per book so the viewport snapshot can't leak across books

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Root-cause / re-init viewport reset → Task 1 (snapshot + restore, first-mount-only fit). ✓
- "Preserve viewport, allow re-layout" behavior → Task 1 restores `pan`/`zoom`; cola `fit: false` untouched so it re-layouts. ✓
- Covers create, edit-with-relation-change, delete (all id-set-change re-inits) → Task 1, single code path. ✓
- Book-switching safeguard (`key={bookId}`) → Task 2. ✓
- Initial auto-fit-on-load kept for first mount → Task 1 `else` branch. ✓
- Testing guidance (synchronous, first-mount fits once, re-init preserves + no refit) → Task 1 Step 1 test + existing fit test retained. ✓
- Unchanged: in-place sync effect, graphAdapter, position persistence, server/API → no tasks touch them. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps — every code step shows complete code and exact commands. ✓

**3. Type consistency:** `viewportRef` typed `{ pan: { x: number; y: number }; zoom: number } | null`; written in cleanup as `{ pan: { ...cy.pan() }, zoom: cy.zoom() }`; read as `cy.viewport({ zoom: viewportRef.current.zoom, pan: viewportRef.current.pan })`. `rafId`/`fitTimer` declared `let ... = 0` and guarded in cleanup with `if (rafId)` / `if (fitTimer)`. Consistent. ✓
