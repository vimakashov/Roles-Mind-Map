# Edge Relationship Edit Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a relationship line on the mind-map canvas opens a modal that edits that one relationship's role and line colour, or deletes it (with confirmation).

**Architecture:** Two new dedicated REST endpoints (`PATCH`/`DELETE /api/relationships/:id`) persist a single edge by id, isolated from the existing character-save reconcile. The canvas gains an `onEdgeTap` callback; `BookScreen` renders a new `RelationEditModal` (a standalone Dialog mirroring one `RelationsModal` row) that stages role/colour locally and applies on «Сохранить».

**Tech Stack:** Fastify 4, Prisma 5, Zod, Vitest (server); React 18, TypeScript, MUI, `@uiw/react-color`, Cytoscape.js, Vitest + Testing Library (web).

## Global Constraints

- Role cap is **30 chars**; an empty/blank role is stored as `""`, never `NULL` (mirror `relationConnectionSchema.role`: `z.string().trim().max(30).optional().default("")`).
- Colour is a hex `#rrggbb` string or `null` (`null` = default `EDGE_COLOR`, never written as a value). Validator: `z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable()`.
- Bodyless requests (DELETE) must **not** set a JSON content-type header — the `req` helper already handles this; use it.
- Colour picker must be a MUI `Popper` (+ `ClickAwayListener`), never a `Popover` (a nested modal `Popover` marks the parent Dialog `aria-hidden`, hiding «Сохранить» from `getByRole`).
- Every overlay wires `useBackClose(open, onClose)` so the system Back button peels one layer per press. `ConfirmDialog` self-manages its own `useBackClose` — do not double-wrap it.
- After large web edits run `npx tsc --noEmit -p web/tsconfig.json` (Vitest's esbuild ignores duplicate imports/decls that the Docker build rejects).
- Run the **full** `npm run test --workspace server` before declaring server changes done.

---

### Task 1: Server — single-relationship PATCH/DELETE endpoints

**Files:**
- Modify: `server/src/schemas.ts` (add `relationUpdateSchema`)
- Create: `server/src/routes/relationships.ts`
- Modify: `server/src/app.ts` (register the new route group)
- Test: `server/test/api.test.ts` (append endpoint tests)

**Interfaces:**
- Consumes: `prisma` from `server/src/db.js`; the existing `hexColor` regex pattern in `schemas.ts`.
- Produces:
  - `relationUpdateSchema` — `{ role: string (default ""), color: string | null }`.
  - `PATCH /api/relationships/:id` — body `{ role?, color }`, returns the updated `Relationship` row (200); `404` if no such id; `400` on invalid body.
  - `DELETE /api/relationships/:id` — `204`; `404` if no such id.
  - `relationshipRoutes(app)` — Fastify plugin registered in `buildApp`.

- [ ] **Step 1: Write the failing endpoint tests**

Append to `server/test/api.test.ts` (the `createBook` helper and `app` already exist at the top of the file):

```ts
async function makeEdge(bookId: string) {
  const a = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId, gender: "male", firstName: "A", lastName: "X", relations: [] },
  })).json();
  await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId, gender: "male", firstName: "B", lastName: "X", relations: [{ otherId: a.id, role: "друзья", color: null }] },
  });
  const graph = (await app.inject({ method: "GET", url: `/api/books/${bookId}/graph` })).json();
  return graph.edges[0];
}

test("updates a relationship's role and colour by id", async () => {
  const book = await createBook();
  const edge = await makeEdge(book.id);

  const res = await app.inject({
    method: "PATCH", url: `/api/relationships/${edge.id}`,
    payload: { role: "враги", color: "#ff0000" },
  });
  expect(res.statusCode).toBe(200);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0].role).toBe("враги");
  expect(graph.edges[0].color).toBe("#ff0000");
});

test("clears a relationship's colour to null and accepts an empty role", async () => {
  const book = await createBook();
  const edge = await makeEdge(book.id);
  await app.inject({ method: "PATCH", url: `/api/relationships/${edge.id}`, payload: { role: "друзья", color: "#123456" } });

  const res = await app.inject({ method: "PATCH", url: `/api/relationships/${edge.id}`, payload: { color: null } });
  expect(res.statusCode).toBe(200);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges[0].role).toBe("");
  expect(graph.edges[0].color).toBeNull();
});

test("rejects an invalid hex colour on relationship update", async () => {
  const book = await createBook();
  const edge = await makeEdge(book.id);
  const res = await app.inject({ method: "PATCH", url: `/api/relationships/${edge.id}`, payload: { role: "x", color: "red" } });
  expect(res.statusCode).toBe(400);
});

test("deletes a relationship by id, leaving its characters", async () => {
  const book = await createBook();
  const edge = await makeEdge(book.id);
  const del = await app.inject({ method: "DELETE", url: `/api/relationships/${edge.id}` });
  expect(del.statusCode).toBe(204);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(0);
});

test("returns 404 for a non-existent relationship on update and delete", async () => {
  const patch = await app.inject({ method: "PATCH", url: "/api/relationships/nope", payload: { role: "x", color: null } });
  expect(patch.statusCode).toBe(404);
  const del = await app.inject({ method: "DELETE", url: "/api/relationships/nope" });
  expect(del.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace server -- api`
Expected: the 5 new tests FAIL (PATCH/DELETE return 404 — routes don't exist yet).

- [ ] **Step 3: Add `relationUpdateSchema` to `server/src/schemas.ts`**

Insert immediately after the existing `relationConnectionSchema` block (it reuses the `hexColor` constant defined just above it):

```ts
export const relationUpdateSchema = z.object({
  role: z.string().trim().max(30).optional().default(""),
  color: hexColor.nullable(),
});
```

And add its inferred type near the other `export type` lines:

```ts
export type RelationUpdate = z.infer<typeof relationUpdateSchema>;
```

- [ ] **Step 4: Create `server/src/routes/relationships.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { relationUpdateSchema } from "../schemas.js";

export async function relationshipRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string } }>("/api/relationships/:id", async (req, reply) => {
    const parsed = relationUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return prisma.relationship.update({ where: { id: req.params.id }, data: parsed.data });
  });

  app.delete<{ Params: { id: string } }>("/api/relationships/:id", async (req, reply) => {
    await prisma.relationship.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
```

Note: a missing id makes Prisma throw `P2025`, which the global error handler in `app.ts` already maps to `404` — no explicit not-found check needed (matches the existing character DELETE route).

- [ ] **Step 5: Register the route group in `server/src/app.ts`**

Add the import beside the existing route imports and register it inside `buildApp` after `characterRoutes`:

```ts
import { relationshipRoutes } from "./routes/relationships.js";
```
```ts
  app.register(characterRoutes);
  app.register(relationshipRoutes);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace server -- api`
Expected: PASS, including the 5 new tests.

- [ ] **Step 7: Run the full server suite (relations wire shape is asserted in two places)**

Run: `npm run test --workspace server`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/schemas.ts server/src/routes/relationships.ts server/src/app.ts server/test/api.test.ts
git commit -m "feat(server): PATCH/DELETE single relationship by id"
```

---

### Task 2: Canvas — wire the edge tap

**Files:**
- Modify: `web/src/canvas/MindMap.tsx`
- Test: `web/src/canvas/__tests__/MindMap.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MindMap` gains an optional prop `onEdgeTap?: (id: string) => void`, invoked with the edge id on `cy.on("tap", "edge")`. Optional so existing call sites (`BookScreen`, current tests) keep compiling until Task 4 supplies it.

- [ ] **Step 1: Write the failing test**

Append to `web/src/canvas/__tests__/MindMap.test.tsx`:

```ts
test("tapping an edge calls onEdgeTap with the edge id", () => {
  const edgeTap = vi.fn();
  const graph: BookGraph = {
    nodes: [
      { id: "c1", bookId: "b1", gender: "male", firstName: "A", lastName: "X" },
      { id: "c2", bookId: "b1", gender: "female", firstName: "B", lastName: "Y" },
    ],
    edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null }],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} onEdgeTap={edgeTap} />);
  const cy = instances[0];
  cy.getElementById("e1").emit("tap");
  expect(edgeTap).toHaveBeenCalledWith("e1");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- MindMap`
Expected: the new test FAILS (`onEdgeTap` is not a prop / handler not bound). Existing MindMap tests still PASS.

- [ ] **Step 3: Add the prop, ref, and edge handler in `web/src/canvas/MindMap.tsx`**

Add to the `Props` interface (after `onNodeMoved`):

```ts
  onEdgeTap?: (id: string) => void;
```

Add `onEdgeTap` to the destructured params:

```ts
export function MindMap({ graph, onNodeTap, onNodeMoved, onEdgeTap }: Props) {
```

Add the ref beside the existing ones (after `onNodeMovedRef.current = onNodeMoved;`):

```ts
  const onEdgeTapRef = useRef(onEdgeTap);
  onEdgeTapRef.current = onEdgeTap;
```

Add the handler in the init effect, right after the existing `cy.on("tap", "node", …)` line:

```ts
    cy.on("tap", "edge", (evt) => onEdgeTapRef.current?.(evt.target.id()));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- MindMap`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/MindMap.tsx web/src/canvas/__tests__/MindMap.test.tsx
git commit -m "feat(web): onEdgeTap callback on the mind-map canvas"
```

---

### Task 3: Web — client API methods + RelationEditModal component

**Files:**
- Modify: `web/src/api/client.ts` (add `updateRelation`, `deleteRelation`; import `Relationship`)
- Create: `web/src/components/RelationEditModal.tsx`
- Test: `web/src/components/__tests__/RelationEditModal.test.tsx`

**Interfaces:**
- Consumes: `api.updateRelation`, `api.deleteRelation`; `EDGE_COLOR` from `../theme.js`; `Relationship` from `../types.js`; `ConfirmDialog`; `useBackClose`.
- Produces:
  - `api.updateRelation(id: string, input: { role: string; color: string | null }) => Promise<Relationship>`
  - `api.deleteRelation(id: string) => Promise<void>`
  - `RelationEditModal` component with props:
    `{ open: boolean; relationship: Relationship; sourceName: string; targetName: string; onCancel: () => void; onChanged: () => void }`.
    On «Сохранить» it calls `api.updateRelation` then `onChanged()`; trash → ConfirmDialog → `api.deleteRelation` then `onChanged()`; «Отмена» → `onCancel()`.

- [ ] **Step 1: Add the client API methods to `web/src/api/client.ts`**

Add `Relationship` to the existing type import (it currently imports `Book, BookGraph, Character, CommentItem, RelationConnection`):

```ts
import type { Book, BookGraph, Character, CommentItem, Relationship, RelationConnection } from "../types.js";
```

Add these two entries to the `api` object (e.g. after `deleteCharacter`):

```ts
  updateRelation: (id: string, input: { role: string; color: string | null }) =>
    req<Relationship>(`/api/relationships/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteRelation: (id: string) =>
    req<void>(`/api/relationships/${id}`, { method: "DELETE" }),
```

- [ ] **Step 2: Write the failing component tests**

Create `web/src/components/__tests__/RelationEditModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";
import { RelationEditModal } from "../RelationEditModal.js";
import type { Relationship } from "../../types.js";
import { __resetBackStack } from "../../lib/backStack.js";

vi.mock("../../api/client.js", () => ({
  api: {
    updateRelation: vi.fn().mockResolvedValue({}),
    deleteRelation: vi.fn().mockResolvedValue(undefined),
  },
}));
import { api } from "../../api/client.js";

const edge: Relationship = { id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null };

beforeEach(() => { vi.clearAllMocks(); __resetBackStack(); });

test("shows both endpoint names and the current role", () => {
  render(<RelationEditModal open relationship={edge} sourceName="Вася Петров" targetName="Маша Иванова" onCancel={() => {}} onChanged={() => {}} />);
  expect(screen.getByText("Вася Петров — Маша Иванова")).toBeInTheDocument();
  expect(screen.getByLabelText(/роль/i)).toHaveValue("друзья");
});

test("edits the role and saves via updateRelation, then calls onChanged", async () => {
  const onChanged = vi.fn();
  render(<RelationEditModal open relationship={edge} sourceName="A" targetName="B" onCancel={() => {}} onChanged={onChanged} />);
  const field = screen.getByLabelText(/роль/i);
  await userEvent.clear(field);
  await userEvent.type(field, "враги");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(api.updateRelation).toHaveBeenCalledWith("e1", { role: "враги", color: null });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("trash opens a confirm dialog; confirming calls deleteRelation and onChanged", async () => {
  const onChanged = vi.fn();
  render(<RelationEditModal open relationship={edge} sourceName="A" targetName="B" onCancel={() => {}} onChanged={onChanged} />);
  await userEvent.click(screen.getByRole("button", { name: /удалить связь/i }));
  expect(await screen.findByText("Удалить связь?")).toBeInTheDocument();
  const confirms = screen.getAllByRole("button", { name: /^удалить$/i });
  await userEvent.click(confirms[confirms.length - 1]);
  expect(api.deleteRelation).toHaveBeenCalledWith("e1");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("Back button cancels the modal", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<RelationEditModal open relationship={edge} sourceName="A" targetName="B" onCancel={onCancel} onChanged={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test --workspace web -- RelationEditModal`
Expected: FAIL — `Cannot find module ../RelationEditModal.js` (component not created yet).

- [ ] **Step 4: Create `web/src/components/RelationEditModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, Stack, Typography, Popper, Paper, ClickAwayListener,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Wheel, ShadeSlider, hexToHsva, hsvaToHex } from "@uiw/react-color";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { api } from "../api/client.js";
import type { Relationship } from "../types.js";
import { EDGE_COLOR } from "../theme.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

interface Props {
  open: boolean;
  relationship: Relationship;
  sourceName: string;
  targetName: string;
  onCancel: () => void;
  onChanged: () => void;
}

export function RelationEditModal({ open, relationship, sourceName, targetName, onCancel, onChanged }: Props) {
  const [role, setRole] = useState(relationship.role);
  const [color, setColor] = useState<string | null>(relationship.color ?? null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(EDGE_COLOR);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) { setRole(relationship.role); setColor(relationship.color ?? null); }
  }, [open, relationship]);

  useBackClose(open, onCancel);
  useBackClose(!!anchor, () => setAnchor(null));

  const openPicker = (el: HTMLElement) => { setDraft(color ?? EDGE_COLOR); setAnchor(el); };

  const validDraft = HEX.test(draft) ? draft : EDGE_COLOR;
  const applyHsva = (patch: { h?: number; s?: number; v?: number }) => {
    const next = hsvaToHex({ ...hexToHsva(validDraft), ...patch });
    setDraft(next);
    setColor(next);
  };
  const onHexInput = (v: string) => {
    setDraft(v);
    if (HEX.test(v)) setColor(v);
  };

  const save = async () => {
    await api.updateRelation(relationship.id, { role: role.trim(), color });
    onChanged();
  };
  const remove = async () => {
    await api.deleteRelation(relationship.id);
    onChanged();
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Связь</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Связь общая для пары персонажей. Роль — симметричная метка (например «друзья», «семья»).
        </Typography>
        <Box sx={{ p: 2, border: "1px solid #eee", borderRadius: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>{`${sourceName} — ${targetName}`}</Typography>
            <IconButton aria-label="цвет линии" onClick={(ev) => openPicker(ev.currentTarget)}>
              <Box sx={{ width: 22, height: 22, borderRadius: "50%", bgcolor: color ?? EDGE_COLOR, border: "1px solid #ccc" }} />
            </IconButton>
            <IconButton aria-label="удалить связь" onClick={() => setConfirmOpen(true)}>
              <DeleteIcon />
            </IconButton>
          </Stack>
          <TextField
            label="Роль"
            value={role}
            inputProps={{ maxLength: 30 }}
            helperText="Необязательно"
            onChange={(e) => setRole(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => void save()}>Сохранить</Button>
      </DialogActions>

      <Popper open={!!anchor} anchorEl={anchor} placement="bottom" sx={{ zIndex: 1400 }}>
        <ClickAwayListener onClickAway={() => setAnchor(null)}>
          <Paper sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
            <Wheel color={hexToHsva(validDraft)} onChange={(c) => applyHsva({ h: c.hsva.h, s: c.hsva.s })} />
            <ShadeSlider hsva={hexToHsva(validDraft)} style={{ width: 210 }} onChange={(s) => applyHsva(s)} />
            <TextField label="HEX" size="small" value={draft} onChange={(e) => onHexInput(e.target.value)} sx={{ width: 210 }} />
          </Paper>
        </ClickAwayListener>
      </Popper>

      <ConfirmDialog
        open={confirmOpen}
        title="Удалить связь?"
        message="Связь между персонажами будет удалена. Это действие необратимо."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); void remove(); }}
      />
    </Dialog>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace web -- RelationEditModal`
Expected: all 4 PASS.

- [ ] **Step 6: Typecheck the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/client.ts web/src/components/RelationEditModal.tsx web/src/components/__tests__/RelationEditModal.test.tsx
git commit -m "feat(web): RelationEditModal + relationship API client methods"
```

---

### Task 4: Web — wire edge tap to the modal in BookScreen

**Files:**
- Modify: `web/src/screens/BookScreen.tsx`
- Test: `web/src/screens/__tests__/BookScreen.test.tsx` (extend the MindMap mock + add a test)

**Interfaces:**
- Consumes: `MindMap`'s `onEdgeTap` (Task 2); `RelationEditModal` (Task 3); `Relationship` from `../types.js`.
- Produces: tapping an edge opens `RelationEditModal` for that edge; on save/delete the graph refreshes and the modal closes.

- [ ] **Step 1: Extend the MindMap mock and write the failing test**

In `web/src/screens/__tests__/BookScreen.test.tsx`, update the `MindMap` mock so it also renders an edge-tap button and add `deleteRelation`/`updateRelation` to the mocked `api`:

Replace the existing `vi.mock("../../canvas/MindMap.js", …)` block with:

```tsx
vi.mock("../../canvas/MindMap.js", () => ({
  MindMap: ({ graph, onNodeTap, onEdgeTap }: { graph: BookGraph; onNodeTap: (id: string) => void; onEdgeTap?: (id: string) => void }) => (
    <div data-testid="mindmap">
      {graph.nodes.map((n) => (
        <button key={n.id} onClick={() => onNodeTap(n.id)}>{`tap-${n.id}`}</button>
      ))}
      {graph.edges.map((e) => (
        <button key={e.id} onClick={() => onEdgeTap?.(e.id)}>{`tap-edge-${e.id}`}</button>
      ))}
    </div>
  ),
}));
```

Add `deleteRelation: vi.fn()` and `updateRelation: vi.fn()` to the mocked `api` object in the `vi.mock("../../api/client.js", …)` block.

Append this test:

```tsx
test("tapping an edge opens the relation modal and deletes the relationship", async () => {
  const withEdge: BookGraph = {
    title: "Война и мир",
    nodes: [
      { id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров" },
      { id: "c2", bookId: "b1", gender: "female", firstName: "Маша", lastName: "Иванова" },
    ],
    edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null }],
  };
  (api.getGraph as any)
    .mockResolvedValueOnce(withEdge)                                   // initial load
    .mockResolvedValueOnce({ ...withEdge, edges: [] });               // after delete
  (api.deleteRelation as any).mockResolvedValue(undefined);

  renderBookScreen();
  await userEvent.click(await screen.findByRole("button", { name: "tap-edge-e1" }));

  expect(await screen.findByText("Вася Петров — Маша Иванова")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /удалить связь/i }));
  const confirms = await screen.findAllByRole("button", { name: /^удалить$/i });
  await userEvent.click(confirms[confirms.length - 1]);

  await waitFor(() => expect(api.deleteRelation).toHaveBeenCalledWith("e1"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- BookScreen`
Expected: the new test FAILS (no `onEdgeTap` wiring / modal not rendered). Existing BookScreen tests still PASS.

- [ ] **Step 3: Wire `onEdgeTap` and render the modal in `web/src/screens/BookScreen.tsx`**

Add the import (beside the other component imports):

```ts
import { RelationEditModal } from "../components/RelationEditModal.js";
import type { BookGraph, Character, Relationship } from "../types.js";
```
(Replace the existing `import type { BookGraph, Character } from "../types.js";` line — add `Relationship`.)

Add state beside the other `useState` hooks:

```ts
  const [editEdge, setEditEdge] = useState<Relationship | null>(null);
```

Pass `onEdgeTap` to `<MindMap>` (alongside `onNodeTap`/`onNodeMoved`):

```tsx
            onEdgeTap={(id) => setEditEdge(graph.edges.find((e) => e.id === id) ?? null)}
```

Add a helper to resolve a node's display name and render the modal. Place this just after the `{modal && ( … )}` block:

```tsx
      {editEdge && (() => {
        const nameOf = (id: string) => {
          const n = graph.nodes.find((x) => x.id === id);
          return n ? `${n.firstName} ${n.lastName ?? ""}`.trim() : id;
        };
        return (
          <RelationEditModal
            open
            relationship={editEdge}
            sourceName={nameOf(editEdge.sourceId)}
            targetName={nameOf(editEdge.targetId)}
            onCancel={() => setEditEdge(null)}
            onChanged={async () => { setEditEdge(null); await refresh(); }}
          />
        );
      })()}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- BookScreen`
Expected: all PASS.

- [ ] **Step 5: Typecheck and run the full web suite**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm run test --workspace web`
Expected: no type errors; all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/screens/BookScreen.tsx web/src/screens/__tests__/BookScreen.test.tsx
git commit -m "feat(web): open RelationEditModal from an edge tap on the canvas"
```

---

## Final verification

- [ ] **Full build + tests**

Run: `npm run build && npm test`
Expected: build succeeds (web bundle + server `tsc`), all server and web tests PASS.

- [ ] **Manual smoke (optional, requires Docker)**

`docker compose up --build`, open a book with at least two linked characters, tap the line between them → the «Связь» modal opens with both names; edit the role, pick a colour, «Сохранить» → the line updates; reopen, trash → confirm → the line disappears; system Back closes the modal (and the colour picker / confirm one layer at a time).

## Notes / gotchas honoured

- `relationUpdateSchema` mirrors `relationConnectionSchema`'s role/colour rules (empty role = `""`, colour hex-or-null).
- Missing-id `404` relies on the global `P2025` → `404` handler already in `app.ts`.
- Colour picker is a `Popper` (+ `ClickAwayListener`), not a `Popover`, keeping «Сохранить» reachable.
- `onEdgeTap` is **optional** on `MindMap` so the canvas task commits independently without breaking `BookScreen`'s typecheck.
- `ConfirmDialog` manages its own `useBackClose`; the modal does not double-wrap the confirm layer. Back-stack tests reset via `__resetBackStack()` and dispatch `popstate` manually (jsdom doesn't fire it from `history.go`).
- Run `npx tsc --noEmit -p web/tsconfig.json` after web edits — Vitest's esbuild ignores duplicate import/decl errors the Docker build rejects.
