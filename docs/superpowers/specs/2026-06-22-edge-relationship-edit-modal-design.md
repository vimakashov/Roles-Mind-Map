# Edit a single relationship by tapping its line — Design

**Date:** 2026-06-22
**Status:** Approved, ready for implementation plan

## Goal

Tapping a relationship line on the mind-map canvas currently does nothing. Make
it open a modal that edits **that one** relationship: a «Роль» field, a colour
picker, and a trash button to delete the relationship, plus «Отмена» /
«Сохранить». Back-navigation closes the top-most overlay (the existing modal
back-stack behaviour), one layer per press.

Reference: the modal mirrors a single row of the existing `RelationsModal`
(other character's name + colour swatch + trash + «Роль» field with
«Необязательно» helper), shown as a standalone dialog.

## Decisions (resolved during brainstorming)

- **Header shows both endpoint names** — «{A} — {B}». An edge has two ends, so a
  single name would be ambiguous about which relationship is being edited.
- **Delete is confirmed** — the trash button opens a `ConfirmDialog`
  («Удалить связь?»); confirming deletes the relationship.
- **Persistence: dedicated relationship endpoints** (not the character
  reconcile). Matches the feature ("settings for *this specific* relationship"),
  keeps the new code in its own well-bounded unit, and leaves the existing
  character-save reconcile (and its two-place wire-shape tests) untouched.
- **Role/colour are staged locally** and applied on «Сохранить» in one PATCH;
  «Отмена» discards.

## Architecture

### 1. Server — `server/src/routes/relationships.ts` (new route group)

Registered in `server/src/server.ts` alongside the existing route groups.

- **`PATCH /api/relationships/:id`** — body validated by a new
  `relationUpdateSchema` in `server/src/schemas.ts`:
  - `role`: `z.string().trim().max(30).optional().default("")` (mirrors
    `relationConnectionSchema.role` — empty role is `""`, never `NULL`).
  - `color`: hex `#rrggbb` or `null` (mirrors the existing connection colour
    rule; `null` renders with the default `EDGE_COLOR`, never written as a
    value).

  Updates `role` + `color` on that one `Relationship` row by id. Returns the
  updated row. `404` if not found.

- **`DELETE /api/relationships/:id`** — deletes the row, returns `204`.

No canonical-order concern: we edit/delete an existing row by id, not create
one, so the `@@unique([sourceId, targetId])` canonical-storage rules don't
apply here.

### 2. Client API — `web/src/api/client.ts`

- `api.updateRelation(id, { role, color })` → `PATCH /api/relationships/:id`.
- `api.deleteRelation(id)` → `DELETE /api/relationships/:id` (bodyless DELETE —
  do **not** set a content-type header, per the bodyless-request gotcha).

### 3. Canvas — `web/src/canvas/MindMap.tsx`

Wire the currently-dead edge tap:

- Add prop `onEdgeTap: (id: string) => void`.
- Add `onEdgeTapRef` kept fresh on every render (same pattern as
  `onNodeTapRef`/`onNodeMovedRef`) to avoid the stale-closure trap — the init
  effect only re-runs on id-set changes.
- In the init effect: `cy.on("tap", "edge", (evt) => onEdgeTapRef.current(evt.target.id()))`.

### 4. New component — `web/src/components/RelationEditModal.tsx`

A standalone `Dialog` mirroring one `RelationsModal` row.

Props (shape to be finalised in the plan): the target relationship
(`{ id, role, color }`) and the two endpoint characters (for names), plus
`open`, `onCancel`, `onSaved`, `onDeleted` (or equivalent callbacks that let
`BookScreen` refresh and close).

Layout:
- Title «Связь»; body text «Связь общая для пары персонажей. Роль —
  симметричная метка (например «друзья», «семья»).».
- Header row: «{A} — {B}» + colour-swatch `IconButton` + trash `IconButton`.
- «Роль» `TextField`, `inputProps={{ maxLength: 30 }}`, helper «Необязательно».
- Colour picker: MUI **`Popper`** + `ClickAwayListener` + `@uiw/react-color`
  `Wheel`/`ShadeSlider`, copied from `RelationsModal`. Must be a `Popper`, not a
  `Popover` (a nested modal `Popover` marks the parent `Dialog` `aria-hidden`
  and makes «Сохранить» unreachable to `getByRole`).
- Actions: «Отмена» (discard) / «Сохранить» (commit via `api.updateRelation`).

Behaviour:
- Role + colour staged in local component state, seeded from the relationship.
- «Сохранить» → one `api.updateRelation(id, { role, color })` → parent refreshes
  the graph and closes.
- Trash → `ConfirmDialog` («Удалить связь?») → confirm →
  `api.deleteRelation(id)` → parent refreshes and closes.
- «Отмена» discards staged edits and closes.

### 5. Back-navigation

`useBackClose(open, onClose)` on each overlay, stacking via the existing
singleton `backStack`, one layer per Back press:
- the `RelationEditModal` itself,
- its colour `Popper`,
- the delete `ConfirmDialog`.

### 6. BookScreen wiring — `web/src/screens/BookScreen.tsx`

- New state `editEdge: Relationship | null`.
- `<MindMap … onEdgeTap={(id) => setEditEdge(graph.edges.find((e) => e.id === id) ?? null)} />`.
- Render `RelationEditModal` when `editEdge` is set; resolve the two endpoint
  names from `graph.nodes` (`editEdge.sourceId` / `editEdge.targetId`).
- On save/delete: `await refresh()` then `setEditEdge(null)`.

## Testing

- **`server/test/relationships.test.ts`** — extend with `PATCH` (role + colour
  update, empty role stays `""`, colour `null` allowed) and `DELETE`-by-id
  cases. Run the **full** `npm run test --workspace server` (the relations wire
  shape is asserted in two places).
- **`web/src/canvas/__tests__/MindMap.test.tsx`** — assert the edge `tap`
  handler invokes `onEdgeTap` (the null-renderer setup is already present).
- **`web/src/components/__tests__/RelationEditModal.test.tsx`** (new) — edit
  role; change colour via the `Popper`; «Сохранить» calls `api.updateRelation`
  with the staged values; trash → confirm → `api.deleteRelation`; «Отмена»
  discards. Back-button closes the top overlay (`__resetBackStack()` + manual
  `popstate` dispatch, since jsdom doesn't fire it from `history.go`).
- After large web edits, run `npx tsc --noEmit -p web/tsconfig.json` (Vitest's
  esbuild ignores duplicate imports/declarations that `tsc` / the Docker build
  reject).

## Out of scope

- No change to the existing `RelationsModal` / character-save reconcile flow.
- No new relationship-creation path (creation stays in the character flow).
- No directional/arrowhead changes (edges remain undirected).
