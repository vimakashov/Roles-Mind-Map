# Relationship edge color — design

**Date:** 2026-06-21
**Status:** Approved, ready for implementation plan

## Goal

Let the user choose the **colour of each relationship line** on the mind-map
canvas. The colour is set per relationship in the relations modal: each selected
target shows a swatch button with its current colour (default = the existing edge
colour). Clicking the swatch opens a circular wheel colour picker (hex). The
chosen colour is persisted in the database like the other relationship
attributes.

## Decisions (resolved during brainstorming)

- **Granularity:** colour is **per edge** (per `(targetId, role)` pair), not per
  role-group.
- **Modal UI:** a swatch button next to **each selected target** within a role
  row.
- **Picker library:** `@uiw/react-color` (`Wheel` component + hex input) — a true
  circular wheel.
- **Default handling:** store `null` when unset; render falls back to the global
  `EDGE_COLOR` (`#9aa8bd`). The global default stays the single source of truth,
  and pre-existing relationships need no data migration.

## 1. Data model

`server/prisma/schema.prisma` — add a nullable colour column to `Relationship`:

```prisma
model Relationship {
  ...
  color String?  // hex "#rrggbb"; null => render with default EDGE_COLOR
  ...
}
```

- No Prisma migrations in this project — `prisma db push` at server boot adds the
  nullable column idempotently. Existing rows get `null` and render with the
  default colour, so no data backfill is needed.

## 2. Server

### `server/src/schemas.ts`

`relationEntrySchema` changes from `targetIds: string[]` to a typed target list
carrying colour:

```ts
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const relationEntrySchema = z.object({
  role: name30,
  targets: z.array(
    z.object({
      id: z.string().min(1),
      color: hexColor.nullable(),
    }),
  ),
});
```

`RelationEntry` type is re-inferred from the schema. `characterCreateSchema` /
`characterUpdateSchema` already nest `relations: z.array(relationEntrySchema)`,
so they pick up the new shape automatically.

### `server/src/services/relationships.ts`

The identity key stays `(targetId, role)`; `color` is an attribute. Extend
`reconcileRelationships`:

- **desired** map value becomes `{ targetId, role, color }`.
- **create** — unchanged set (keys not in `existing`), now writing `color`.
- **delete** — unchanged (keys in `existing` not in `desired`).
- **update** (new) — for keys present in both where the stored `color` differs
  from desired, update `color`. This covers the "only the colour changed"
  scenario, which the current create/delete-only reconcile would silently ignore.

## 3. Web types & graph adapter

### `web/src/types.ts`

```ts
export interface Relationship {
  ...
  color?: string | null;
}

export interface RelationTarget { id: string; color: string | null }

export interface RelationEntry {
  role: string;
  targets: RelationTarget[];
}
```

### `web/src/lib/relations.ts`

- `groupEdges` — group a source's outgoing edges by role; each target carries its
  edge `color` (`{ id, color }`).
- `expandEntries` — flat-map entries to `{ targetId, role, color }`.

### `web/src/lib/graphAdapter.ts`

Edge `data` gains `color: e.color ?? null`.

## 4. Canvas (`web/src/canvas/MindMap.tsx`)

In the `edge` style, `line-color` and `target-arrow-color` become functions with
the default fallback in one place:

```ts
"line-color": (ele: any) => ele.data("color") || EDGE_COLOR,
"target-arrow-color": (ele: any) => ele.data("color") || EDGE_COLOR,
```

The existing in-place sync effect already spreads all mutable edge `data` fields,
so a colour change re-renders without a full reload (same path used for editing
`role`).

## 5. Modal UI (`web/src/components/RelationsModal.tsx`)

Within each role row, below the multi-select targets, render a list of the
selected targets. Each item shows the target's name + a swatch button filled with
its current colour (a `null` colour shows `EDGE_COLOR`).

- Clicking a swatch opens an MUI `Popover` containing `@uiw/react-color` `Wheel`
  plus a hex input. Selecting a colour writes `targets[i].color`.
- Selecting a new target in the multi-select adds it to `targets` with
  `color: null` (default); deselecting removes it from `targets`.
- The multi-select `value` is derived from `targets.map(t => t.id)`.

New dependency: `@uiw/react-color` in `web/package.json`.

## 6. Tests

- **server `relationships.test.ts`** — colour persists on create; colour updates
  on change (same role+target); invalid hex → 400; `null` renders as default
  (returned as null in the graph payload).
- **web `graphAdapter.test.ts`** — edge carries `color`; null fallback present.
- **web `relations` tests** — `groupEdges` / `expandEntries` round-trip colour.
- **web `RelationsModal.test.tsx`** — swatch renders per target; popover opens;
  picking a colour updates the staged entry.

## Out of scope (YAGNI)

- No dedicated "reset to default" button. The default look is recoverable by
  picking the default colour manually. Can be added later if needed.
