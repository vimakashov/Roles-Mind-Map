# Preserve canvas viewport across character add/edit

**Date:** 2026-06-26
**Status:** Design approved, pending spec review

## Problem

When the user zooms/pans the mind-map canvas to focus on a character and then
either **edits that character in a way that changes its relations** or **creates
a new character**, the canvas jumps back: it resets the zoom level and pan
position (and re-frames the whole graph), throwing the user out of the spot they
were working in. The expected behavior is that the canvas reflects the new/edited
data **without changing the current zoom and pan** — the user stays exactly where
they were on screen.

## Root cause

`web/src/canvas/MindMap.tsx` has two effects:

1. An **init effect** keyed on the *set* of node/edge ids
   (`[graph.nodes.map(n => n.id).join(","), graph.edges.map(e => e.id).join(",")]`).
   When the id set changes it tears down and re-creates the entire Cytoscape
   instance, which (a) re-runs the cola layout and (b) re-runs the
   auto-fit-on-load machinery (`cy.fit(...)`), discarding the user's pan/zoom.
2. An **in-place sync effect** keyed on `[graph]` that spreads mutable `data`
   fields into the existing instance for attribute-only edits.

After a save, `BookScreen.refresh()` re-fetches the graph. A pure attribute edit
(same id set) goes through effect (2) and already preserves the viewport. But:

- **Creating a character** adds a node id → effect (1) re-inits → viewport reset.
- **Editing a character that adds/removes a relation** adds/removes an edge id →
  effect (1) re-inits → viewport reset.
- **Deleting a character** removes ids → same re-init → viewport reset.

So the bug lives entirely on the **id-set-change re-init path**.

## Chosen behavior

Preserve the **viewport (zoom + pan)** across graph mutations. The cola layout is
allowed to re-run and re-spread nodes as it does today (existing nodes may shift
in graph-space); only the *viewport* is held steady. This is the user-selected
option ("Сохранить view, но переразложить").

The initial auto-fit-on-load (framing the whole graph the first time a book
opens) is **kept** — it only applies to the very first mount, not to subsequent
re-inits.

## Design (Approach 1 — capture & restore viewport around re-init)

All changes are in `web/src/canvas/MindMap.tsx`, plus a one-line safeguard in
`web/src/screens/BookScreen.tsx`. No server, schema, API, or `graphAdapter`
changes.

### 1. Viewport snapshot ref

Add a ref that survives across re-inits of the effect:

```ts
const viewportRef = useRef<{ pan: { x: number; y: number }; zoom: number } | null>(null);
```

`null` means "no snapshot yet" → first mount.

### 2. Capture on teardown

In the init effect's **cleanup** (which runs before every re-init and on
unmount), snapshot the current viewport *before* destroying the instance:

```ts
return () => {
  viewportRef.current = { pan: { ...cy.pan() }, zoom: cy.zoom() };
  window.clearTimeout(fitTimer);
  if (rafId) cancelAnimationFrame(rafId);
  cy.destroy();
  cyRef.current = null;
};
```

(Clone `cy.pan()` — it returns a live position object.)

### 3. Restore (or first-mount fit) on init

After creating the instance and binding the tap/dragfree handlers, branch on the
snapshot:

- **Re-init** (`viewportRef.current` is set): restore the viewport and **skip**
  the entire auto-fit block (no `cy.fit`, no `position`/gesture listeners, no
  settle timer):

  ```ts
  cy.viewport({ zoom: viewportRef.current.zoom, pan: viewportRef.current.pan });
  ```

  Because the cola layout is configured with `fit: false`, it re-spreads nodes
  without touching the viewport, so the restored pan/zoom holds.

- **First mount** (`viewportRef.current` is `null`): run the existing auto-fit
  machinery unchanged (`autoFit`/`queueFit`/`stopAutoFit`/`fitTimer`/`fitNow()`).

The cleanup must still clear `fitTimer`/`rafId` safely on the re-init path; guard
the timer/raf variables so the cleanup works whether or not the auto-fit block
ran (e.g. initialize `let rafId = 0` and `let fitTimer = 0` and only assign them
inside the first-mount branch).

### 4. `BookScreen` safeguard

`/books/:bookId` reuses the same `BookScreen`/`MindMap` element across param
changes in React Router. In normal navigation the user always returns to `/`
(unmounting `BookScreen`) before opening another book, so `MindMap` remounts and
the snapshot ref is discarded per book. To make this guarantee explicit and
prevent a stale snapshot from ever leaking across books, key the canvas by book:

```tsx
<MindMap key={bookId} graph={graph} ... />
```

Within a single book `bookId` is constant, so the snapshot correctly persists
across graph mutations; switching books forces a fresh mount (and a fresh
auto-fit).

## What is unchanged

- The in-place sync effect (`[graph]`) — attribute-only edits already preserve
  the viewport and continue to.
- cola layout configuration (`animate`, `infinite`, `fit: false`, edge length,
  spacing, overlap avoidance).
- `graphAdapter`, position persistence (`dragfree` → `savePosition`), and all
  server/API behavior.
- The initial auto-fit-on-load for a freshly opened book.

## Edge cases

- **First open of a book:** `viewportRef` is `null` → auto-fit runs as today.
- **Add / remove relation while editing:** edge id set changes → re-init →
  viewport restored.
- **Delete character:** node id set changes → re-init → viewport restored
  (consistent with create/edit, even though not explicitly reported).
- **Linked-create flow (`submitAndCreateLinked`):** saves A, refreshes (re-init,
  viewport restored), opens B's modal. The user stays put through the A save.
- **Switch books:** `key={bookId}` forces remount → fresh auto-fit, no stale
  snapshot.
- **User has not yet interacted (auto-fit still active) then adds a character:**
  cleanup snapshots the currently-fitted viewport, re-init restores it — the user
  keeps whatever they currently see.

## Testing

Extend `web/src/canvas/__tests__/MindMap.test.tsx` (must stay **synchronous** —
do not await an animation frame; cola would tick in jsdom's null renderer and
throw, per the project gotcha). Using the existing null-renderer setup and a
`Core.prototype` spy:

1. **First mount fits once:** render with graph A → `cy.fit` called exactly once
   (existing assertion, keep).
2. **Re-init preserves viewport, no refit:** spy `Core.prototype.viewport` (and
   `pan`/`zoom` as needed to feed a known snapshot), render with graph A, then
   re-render with graph A + an added node (id-set change). Assert:
   - `cy.fit` was **not** called a second time (still called once total), and
   - `cy.viewport` was called with the captured `{ zoom, pan }`.

Run `npm run test --workspace web -- MindMap` and
`npx tsc --noEmit -p web/tsconfig.json` after the change.

## Out of scope

- Incremental `cy.add()`/`cy.remove()` without teardown (Approach 2) — rejected;
  the user accepted re-layout, so the simpler viewport-restore fix suffices.
- Preserving exact existing-node positions across mutations — explicitly not
  required (re-layout is acceptable).
