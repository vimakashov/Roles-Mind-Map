# Relationship Edge Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick a colour for each relationship line on the mind-map canvas via a circular wheel picker in the relations modal, persisted per edge in the database.

**Architecture:** Add a nullable `color` column to `Relationship` (hex `#rrggbb`; `null` = default). The relations modal carries colour per target (`RelationEntry.targets: {id, color}[]`), a swatch button per target opens a `@uiw/react-color` Wheel popover, and `reconcileRelationships` gains an update path so colour-only edits persist. The Cytoscape edge style falls back to the existing `EDGE_COLOR` when an edge has no colour.

**Tech Stack:** Fastify 4, Prisma 5 + SQLite, Zod, React 18 + TypeScript + MUI, Cytoscape.js, `@uiw/react-color`, Vitest.

## Global Constraints

- No Prisma migrations — schema reaches the DB via `prisma db push` (server boot + test `setupTestDb`). After editing `schema.prisma`, run `npx prisma generate` so the TS client picks up the new field.
- Hex colour format is exactly `#rrggbb`, validated by `/^#[0-9a-fA-F]{6}$/`.
- Default edge colour is `EDGE_COLOR = "#9aa8bd"` from `web/src/theme.ts`; `null` colour renders with it. The default is never written to the DB.
- Pure-JS server — no native/image dependencies added.
- Run `npx tsc --noEmit -p web/tsconfig.json` after large web edits (Vitest/esbuild skips type errors that the Docker build catches).
- The wire shape of `RelationEntry` must stay identical between `web/src/types.ts` and `server/src/schemas.ts` (it is the JSON body of character create/update).
- The relations modal API client (`web/src/api/client.ts`) sends a JSON content-type only when a body is present — do not change that.

---

## Task 1: Server — colour column, validation, and reconcile update path

**Files:**
- Modify: `server/prisma/schema.prisma:45-57`
- Modify: `server/src/schemas.ts:8-11`
- Modify: `server/src/services/relationships.ts` (whole `reconcileRelationships`)
- Test: `server/test/relationships.test.ts` (rewrite to new shape + colour cases)

**Interfaces:**
- Produces: `Relationship.color: string | null` (Prisma model + graph payload).
- Produces: `relationEntrySchema = { role: string; targets: { id: string; color: string | null }[] }` and the re-inferred `RelationEntry` type.
- Produces: `reconcileRelationships(tx, bookId, sourceId, entries: RelationEntry[]): Promise<void>` — creates, deletes, and now updates colour for existing `(targetId, role)` edges.

- [ ] **Step 1: Add the colour column to the Prisma schema**

In `server/prisma/schema.prisma`, add the `color` field to the `Relationship` model (after `role`):

```prisma
model Relationship {
  id        String   @id @default(cuid())
  bookId    String
  sourceId  String
  targetId  String
  role      String
  color     String?  // hex "#rrggbb"; null => render with default EDGE_COLOR
  createdAt DateTime @default(now())
  book      Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  source    Character @relation("source", fields: [sourceId], references: [id], onDelete: Cascade)
  target    Character @relation("target", fields: [targetId], references: [id], onDelete: Cascade)

  @@unique([sourceId, targetId, role])
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `npx prisma generate --schema server/prisma/schema.prisma`
Expected: "Generated Prisma Client" success; `Relationship` type now includes `color`.

- [ ] **Step 3: Update the validation schema**

In `server/src/schemas.ts`, replace the `relationEntrySchema` block (lines 8-11):

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

(`RelationEntry`, `characterCreateSchema`, `characterUpdateSchema` are derived from this and need no further edits.)

- [ ] **Step 4: Rewrite the relationships test file (failing tests first)**

Replace the entire contents of `server/test/relationships.test.ts` with:

```ts
import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileRelationships } from "../src/services/relationships.js";
import { relationEntrySchema } from "../src/schemas.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seed() {
  const book = await prisma.book.create({
    data: { userId: DEFAULT_USER_ID, title: "Book" },
  });
  const mk = (firstName: string) =>
    prisma.character.create({
      data: { bookId: book.id, gender: "male", firstName, lastName: "X" },
    });
  const vasya = await mk("Vasya");
  const petya = await mk("Petya");
  const zhanna = await mk("Zhanna");
  return { book, vasya, petya, zhanna };
}

test("expands one entry with multiple targets into multiple rows", async () => {
  const { book, vasya, petya, zhanna } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targets: [{ id: petya.id, color: null }, { id: zhanna.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.role === "сын")).toBe(true);
});

test("adds and removes rows to match desired set", async () => {
  const { book, vasya, petya, zhanna } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targets: [{ id: zhanna.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].targetId).toBe(zhanna.id);
});

test("drops self-relations", async () => {
  const { book, vasya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "self", targets: [{ id: vasya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(0);
});

test("dedupes identical (target, role) pairs across entries", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targets: [{ id: petya.id, color: null }] },
      { role: "сын", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
});

test("persists colour on create", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: "#ff0000" }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows[0].color).toBe("#ff0000");
});

test("stores null colour as default (no colour written)", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows[0].color).toBeNull();
});

test("updates colour when only the colour changes", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: "#111111" }] },
    ]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: "#222222" }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].color).toBe("#222222");
});

test("rejects an invalid hex colour", () => {
  const result = relationEntrySchema.safeParse({
    role: "друг",
    targets: [{ id: "x", color: "red" }],
  });
  expect(result.success).toBe(false);
});

test("accepts a null colour", () => {
  const result = relationEntrySchema.safeParse({
    role: "друг",
    targets: [{ id: "x", color: null }],
  });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm run test --workspace server -- relationships`
Expected: FAIL — `reconcileRelationships` still reads `entry.targetIds` (colour tests fail / type mismatch).

- [ ] **Step 6: Implement the reconcile update path**

Replace the body of `reconcileRelationships` in `server/src/services/relationships.ts` with:

```ts
export async function reconcileRelationships(
  tx: Tx,
  bookId: string,
  sourceId: string,
  entries: RelationEntry[],
): Promise<void> {
  const desired = new Map<string, { targetId: string; role: string; color: string | null }>();
  for (const entry of entries) {
    const role = entry.role.trim();
    for (const t of entry.targets) {
      if (t.id === sourceId) continue;
      desired.set(key(t.id, role), { targetId: t.id, role, color: t.color });
    }
  }

  const existing = await tx.relationship.findMany({ where: { sourceId } });
  const existingByKey = new Map(existing.map((r) => [key(r.targetId, r.role), r]));

  const toDelete = existing.filter((r) => !desired.has(key(r.targetId, r.role)));
  if (toDelete.length > 0) {
    await tx.relationship.deleteMany({
      where: { id: { in: toDelete.map((r) => r.id) } },
    });
  }

  const toCreate = [...desired.entries()]
    .filter(([k]) => !existingByKey.has(k))
    .map(([, v]) => ({ bookId, sourceId, targetId: v.targetId, role: v.role, color: v.color }));
  if (toCreate.length > 0) {
    await tx.relationship.createMany({ data: toCreate });
  }

  for (const [k, v] of desired) {
    const ex = existingByKey.get(k);
    if (ex && ex.color !== v.color) {
      await tx.relationship.update({ where: { id: ex.id }, data: { color: v.color } });
    }
  }
}
```

(Keep the existing `import type { RelationEntry } from "../schemas.js";` and `key` helper at the top of the file unchanged.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test --workspace server -- relationships`
Expected: PASS (all 10 tests).

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/src/schemas.ts server/src/services/relationships.ts server/test/relationships.test.ts
git commit -m "feat(server): persist per-edge relationship colour"
```

---

## Task 2: Web — types and relations grouping carry colour

**Files:**
- Modify: `web/src/types.ts:22-39`
- Modify: `web/src/lib/relations.ts` (whole file)
- Test: `web/src/lib/__tests__/relations.test.ts` (rewrite)

**Interfaces:**
- Consumes: `Relationship.color` shape concept from Task 1.
- Produces: `Relationship.color?: string | null`; `RelationTarget = { id: string; color: string | null }`; `RelationEntry = { role: string; targets: RelationTarget[] }`.
- Produces: `groupEdges(sourceId, edges): RelationEntry[]` (targets carry edge colour); `expandEntries(entries): { targetId: string; role: string; color: string | null }[]`.

- [ ] **Step 1: Update the web types**

In `web/src/types.ts`, replace the `Relationship` and `RelationEntry` declarations (lines 22-39) with:

```ts
export interface Relationship {
  id: string;
  bookId: string;
  sourceId: string;
  targetId: string;
  role: string;
  color?: string | null;
}

export interface BookGraph {
  nodes: Character[];
  edges: Relationship[];
}

/** A relation target and the colour of its line (null = default). */
export interface RelationTarget {
  id: string;
  color: string | null;
}

/** UI-level grouping: one role with its selected targets. */
export interface RelationEntry {
  role: string;
  targets: RelationTarget[];
}
```

(The existing `BookGraph` block is duplicated here only because it sits between the two edited interfaces — keep exactly one `BookGraph` declaration in the file.)

- [ ] **Step 2: Rewrite the relations test (failing first)**

Replace the entire contents of `web/src/lib/__tests__/relations.test.ts` with:

```ts
import { expect, test } from "vitest";
import { groupEdges, expandEntries } from "../relations.js";
import type { Relationship } from "../../types.js";

const edge = (
  sourceId: string, targetId: string, role: string, color: string | null = null,
): Relationship => ({
  id: `${sourceId}-${targetId}-${role}`, bookId: "b", sourceId, targetId, role, color,
});

test("groups a source's edges by role, carrying each target's colour", () => {
  const edges = [
    edge("v", "p", "сын", "#ff0000"),
    edge("v", "z", "сын"),
    edge("v", "e", "муж"),
  ];
  const entries = groupEdges("v", edges);
  expect(entries).toEqual([
    { role: "сын", targets: [{ id: "p", color: "#ff0000" }, { id: "z", color: null }] },
    { role: "муж", targets: [{ id: "e", color: null }] },
  ]);
});

test("ignores edges where the character is the target", () => {
  const edges = [edge("x", "v", "друг")];
  expect(groupEdges("v", edges)).toEqual([]);
});

test("expandEntries flattens to (targetId, role, color) triples", () => {
  const pairs = expandEntries([
    { role: "сын", targets: [{ id: "p", color: "#00ff00" }, { id: "z", color: null }] },
  ]);
  expect(pairs).toEqual([
    { targetId: "p", role: "сын", color: "#00ff00" },
    { targetId: "z", role: "сын", color: null },
  ]);
});

test("expandEntries round-trips multiple roles in order", () => {
  const pairs = expandEntries([
    { role: "сын", targets: [{ id: "p", color: null }, { id: "z", color: null }] },
    { role: "муж", targets: [{ id: "e", color: null }] },
  ]);
  expect(pairs).toEqual([
    { targetId: "p", role: "сын", color: null },
    { targetId: "z", role: "сын", color: null },
    { targetId: "e", role: "муж", color: null },
  ]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace web -- relations`
Expected: FAIL — `groupEdges` still produces `{ role, targetIds }`.

- [ ] **Step 4: Implement the colour-aware grouping**

Replace the entire contents of `web/src/lib/relations.ts` with:

```ts
import type { Relationship, RelationEntry, RelationTarget } from "../types.js";

/** Group a single source character's outgoing edges into role-keyed entries (insertion order). */
export function groupEdges(sourceId: string, edges: Relationship[]): RelationEntry[] {
  const byRole = new Map<string, RelationTarget[]>();
  for (const e of edges) {
    if (e.sourceId !== sourceId) continue;
    const list = byRole.get(e.role) ?? [];
    list.push({ id: e.targetId, color: e.color ?? null });
    byRole.set(e.role, list);
  }
  return [...byRole.entries()].map(([role, targets]) => ({ role, targets }));
}

export function expandEntries(
  entries: RelationEntry[],
): { targetId: string; role: string; color: string | null }[] {
  return entries.flatMap((entry) =>
    entry.targets.map((t) => ({ targetId: t.id, role: entry.role, color: t.color })),
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace web -- relations`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/lib/relations.ts web/src/lib/__tests__/relations.test.ts
git commit -m "feat(web): carry relationship colour through types and grouping"
```

---

## Task 3: Web — graph adapter and canvas render edge colour

**Files:**
- Modify: `web/src/lib/graphAdapter.ts:28-30`
- Modify: `web/src/canvas/MindMap.tsx:54-68`
- Test: `web/src/lib/__tests__/graphAdapter.test.ts`

**Interfaces:**
- Consumes: `Relationship.color` (Task 2).
- Produces: edge Cytoscape `data` includes `color: string | null`; canvas `line-color`/`target-arrow-color` fall back to `EDGE_COLOR` when `color` is falsy.

- [ ] **Step 1: Add failing graph-adapter assertions**

In `web/src/lib/__tests__/graphAdapter.test.ts`, replace the existing test `"maps edges with role label and source/target"` with these two tests:

```ts
test("maps edges with role label, source/target, and null colour by default", () => {
  const els = toElements(graph);
  const edge = els.find((e) => e.data.id === "e1")!;
  expect(edge.data).toMatchObject({ source: "v", target: "p", label: "сын", color: null });
});

test("passes an explicit edge colour through to the element data", () => {
  const g: BookGraph = {
    nodes: graph.nodes,
    edges: [{ id: "e2", bookId: "b", sourceId: "v", targetId: "p", role: "друг", color: "#abcdef" }],
  };
  const edge = toElements(g).find((e) => e.data.id === "e2")!;
  expect(edge.data.color).toBe("#abcdef");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — edge data has no `color` field (`null` !== `undefined`).

- [ ] **Step 3: Add colour to the edge element data**

In `web/src/lib/graphAdapter.ts`, replace the edges mapping (lines 28-30):

```ts
  const edges: CyElement[] = graph.edges.map((e) => ({
    data: { id: e.id, source: e.sourceId, target: e.targetId, label: e.role, color: e.color ?? null },
  }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS.

- [ ] **Step 5: Apply the edge colour in the canvas style**

In `web/src/canvas/MindMap.tsx`, inside the `edge` selector style (lines 54-68), replace the two static colour lines:

```ts
            "line-color": EDGE_COLOR,
            "target-arrow-color": EDGE_COLOR,
```

with functions that fall back to the default:

```ts
            "line-color": (ele: any) => ele.data("color") || EDGE_COLOR,
            "target-arrow-color": (ele: any) => ele.data("color") || EDGE_COLOR,
```

(The `EDGE_COLOR` import at line 6 stays. The in-place sync effect already spreads all mutable edge `data`, so colour edits re-render live — no further change there.)

- [ ] **Step 6: Run the full web suite to confirm nothing regressed**

Run: `npm run test --workspace web -- graphAdapter relations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/graphAdapter.ts web/src/canvas/MindMap.tsx web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): render relationship line colour on the canvas"
```

---

## Task 4: Web — colour swatch + wheel picker in the relations modal

**Files:**
- Modify: `web/package.json` (add `@uiw/react-color`)
- Modify: `web/src/components/RelationsModal.tsx` (whole file)
- Test: `web/src/components/__tests__/RelationsModal.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `RelationEntry`/`RelationTarget` (Task 2), `EDGE_COLOR` (`web/src/theme.ts`).
- Produces: `RelationsModal` `onSave(entries: RelationEntry[])` where each target carries its chosen colour (or `null` if untouched).

- [ ] **Step 1: Add the picker dependency**

Run: `npm install @uiw/react-color --workspace web`
Expected: `@uiw/react-color` appears in `web/package.json` dependencies; install succeeds.

- [ ] **Step 2: Rewrite the modal test (failing first)**

Replace the entire contents of `web/src/components/__tests__/RelationsModal.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RelationsModal } from "../RelationsModal.js";
import type { Character } from "../../types.js";

// The wheel/shade widgets are third-party canvas-ish components; mock them so the
// test exercises our modal state via the HEX input deterministically.
vi.mock("@uiw/react-color", () => ({
  Wheel: () => null,
  ShadeSlider: () => null,
  hexToHsva: () => ({ h: 0, s: 0, v: 0, a: 1 }),
  hsvaToHex: () => "#000000",
}));

const others: Character[] = [
  { id: "p", bookId: "b", gender: "male", firstName: "Петя", lastName: "П" },
  { id: "z", bookId: "b", gender: "female", firstName: "Жанна", lastName: "Ж" },
];

test("adds an entry and returns it on save", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.type(screen.getByLabelText(/роль/i), "сын");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ role: "сын", targets: [] }]);
});

test("picks a colour for a target via the hex input", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal
      open
      others={others}
      value={[{ role: "друг", targets: [{ id: "p", color: null }] }]}
      onCancel={() => {}}
      onSave={onSave}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /цвет линии для Петя П/i }));
  const hex = screen.getByLabelText(/hex/i);
  await userEvent.clear(hex);
  await userEvent.type(hex, "#112233");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([
    { role: "друг", targets: [{ id: "p", color: "#112233" }] },
  ]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace web -- RelationsModal`
Expected: FAIL — current modal uses `targetIds` and has no colour swatch/hex input.

- [ ] **Step 4: Rewrite the relations modal**

Replace the entire contents of `web/src/components/RelationsModal.tsx` with:

```tsx
import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, MenuItem, Select, InputLabel, FormControl, OutlinedInput,
  Chip, Stack, Typography, Popover,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Wheel, ShadeSlider, hexToHsva, hsvaToHex } from "@uiw/react-color";
import type { Character, RelationEntry } from "../types.js";
import { EDGE_COLOR } from "../theme.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

interface Props {
  open: boolean;
  others: Character[];
  value: RelationEntry[];
  onCancel: () => void;
  onSave: (entries: RelationEntry[]) => void;
}

interface Picker { entryIndex: number; targetId: string; anchor: HTMLElement }

export function RelationsModal({ open, others, value, onCancel, onSave }: Props) {
  const [entries, setEntries] = useState<RelationEntry[]>(value);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [draft, setDraft] = useState(EDGE_COLOR);

  useEffect(() => { if (open) setEntries(value); }, [open]);

  const update = (i: number, patch: Partial<RelationEntry>) =>
    setEntries((e) => e.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const nameOf = (id: string) => {
    const c = others.find((o) => o.id === id);
    return c ? `${c.firstName} ${c.lastName}` : id;
  };

  const setColor = (entryIndex: number, targetId: string, color: string) =>
    setEntries((es) =>
      es.map((e, i) =>
        i === entryIndex
          ? { ...e, targets: e.targets.map((t) => (t.id === targetId ? { ...t, color } : t)) }
          : e,
      ),
    );

  const openPicker = (entryIndex: number, targetId: string, anchor: HTMLElement) => {
    const cur = entries[entryIndex].targets.find((t) => t.id === targetId)?.color ?? EDGE_COLOR;
    setDraft(cur);
    setPicker({ entryIndex, targetId, anchor });
  };

  const validDraft = HEX.test(draft) ? draft : EDGE_COLOR;

  const applyHsva = (patch: { h?: number; s?: number; v?: number }) => {
    if (!picker) return;
    const next = hsvaToHex({ ...hexToHsva(validDraft), ...patch });
    setDraft(next);
    setColor(picker.entryIndex, picker.targetId, next);
  };

  const onHexInput = (v: string) => {
    setDraft(v);
    if (HEX.test(v) && picker) setColor(picker.entryIndex, picker.targetId, v);
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Связи</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          «Я — [роль] для выбранных». Например: роль «сын» → Пётр, Жанна.
        </Typography>
        <Stack spacing={2}>
          {entries.map((entry, i) => (
            <Box key={i} sx={{ p: 2, border: "1px solid #eee", borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  label="Роль"
                  value={entry.role}
                  inputProps={{ maxLength: 30 }}
                  onChange={(e) => update(i, { role: e.target.value })}
                  fullWidth
                />
                <IconButton
                  aria-label="удалить связь"
                  onClick={() => setEntries((e) => e.filter((_, idx) => idx !== i))}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel id={`tgt-${i}`}>Связь</InputLabel>
                <Select
                  labelId={`tgt-${i}`}
                  multiple
                  value={entry.targets.map((t) => t.id)}
                  input={<OutlinedInput label="Связь" />}
                  onChange={(e) => {
                    const ids = typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : e.target.value;
                    update(i, {
                      targets: ids.map(
                        (id) => entry.targets.find((t) => t.id === id) ?? { id, color: null },
                      ),
                    });
                  }}
                  renderValue={(ids) => (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {ids.map((id) => <Chip key={id} label={nameOf(id)} size="small" />)}
                    </Box>
                  )}
                >
                  {others.map((o) => (
                    <MenuItem key={o.id} value={o.id}>{o.firstName} {o.lastName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {entry.targets.length > 0 && (
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">Цвета линий</Typography>
                  {entry.targets.map((t) => (
                    <Stack
                      key={t.id}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="body2">{nameOf(t.id)}</Typography>
                      <IconButton
                        aria-label={`цвет линии для ${nameOf(t.id)}`}
                        onClick={(ev) => openPicker(i, t.id, ev.currentTarget)}
                      >
                        <Box sx={{
                          width: 22, height: 22, borderRadius: "50%",
                          bgcolor: t.color ?? EDGE_COLOR, border: "1px solid #ccc",
                        }} />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
        <Button sx={{ mt: 2 }} onClick={() => setEntries((e) => [...e, { role: "", targets: [] }])}>
          + Добавить связь
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(entries)}>Сохранить</Button>
      </DialogActions>

      <Popover
        open={!!picker}
        anchorEl={picker?.anchor ?? null}
        onClose={() => setPicker(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
          <Wheel
            color={hexToHsva(validDraft)}
            onChange={(c) => applyHsva({ h: c.hsva.h, s: c.hsva.s })}
          />
          <ShadeSlider
            hsva={hexToHsva(validDraft)}
            style={{ width: 210 }}
            onChange={(s) => applyHsva(s)}
          />
          <TextField
            label="HEX"
            size="small"
            value={draft}
            onChange={(e) => onHexInput(e.target.value)}
            sx={{ width: 210 }}
          />
        </Box>
      </Popover>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run the modal test to verify it passes**

Run: `npm run test --workspace web -- RelationsModal`
Expected: PASS (2 tests).

- [ ] **Step 6: Type-check the web package (whole-file edit safety net)**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors (exit 0). Confirms `RelationsModal.tsx`, `CharacterModal.tsx`, `BookScreen.tsx`, and `client.ts` all agree on the new `RelationEntry` shape, and there is exactly one import block in the rewritten file.

- [ ] **Step 7: Run the whole web suite**

Run: `npm run test --workspace web`
Expected: PASS (including `CharacterModal` and `client` tests, which use `relations: []`).

- [ ] **Step 8: Commit**

```bash
git add web/package.json package-lock.json web/src/components/RelationsModal.tsx web/src/components/__tests__/RelationsModal.test.tsx
git commit -m "feat(web): colour swatch and wheel picker in the relations modal"
```

---

## Task 5: Docs — record the relationship colour feature

**Files:**
- Modify: `CLAUDE.md` (Schema paragraph + a new bullet in the architecture / gotchas)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the schema description**

In `CLAUDE.md`, in the **Schema** paragraph under *Architecture*, update the `Relationship` mention to note the colour column. Append to the sentence that lists the models:

```markdown
A directed relationship edge means "source is [role] of target" (e.g. "Frodo is friend of Sam") and carries an optional `color` (hex `#rrggbb`, nullable) for its canvas line; `null` renders with the default `EDGE_COLOR`.
```

- [ ] **Step 2: Add a gotcha bullet**

In `CLAUDE.md`, under **Gotchas (learned the hard way — keep in mind)**, add:

```markdown
- **Relationship colour & reconcile** — `Relationship.color` is nullable (`null` = default `EDGE_COLOR`, never written to the DB). `reconcileRelationships` keys edges by `(targetId, role)`; colour is an *attribute*, so the reconcile has a dedicated **update** branch for colour-only changes — a create/delete-only reconcile would silently drop them. The relations modal carries colour per target (`RelationEntry.targets: {id, color}[]`) and the canvas `line-color`/`target-arrow-color` fall back to `EDGE_COLOR` when an edge's `color` is null.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document per-edge relationship colour"
```

---

## Self-Review notes

- **Spec coverage:** data model (Task 1.1), schema validation incl. invalid-hex (Task 1.3-4), reconcile update path (Task 1.6), web types/relations (Task 2), graph adapter + canvas fallback (Task 3), modal swatch + `@uiw/react-color` Wheel popover + dependency + default handling (Task 4), all six test groups from the spec (Tasks 1-4), out-of-scope "reset" intentionally omitted. Docs added (Task 5) consistent with repo convention.
- **Type consistency:** `RelationEntry = { role, targets: {id, color}[] }` is identical in `web/src/types.ts` (Task 2) and inferred from `relationEntrySchema` (Task 1); `expandEntries`/`groupEdges`/`reconcileRelationships`/modal all use `targets`; edge data field is `color` everywhere; default constant is `EDGE_COLOR` throughout.
- **No placeholders:** every code and test step contains full content; commands have expected output.
