# Rename Books + Optional Surname & Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add book renaming (pencil icon → modal) and make the character surname (`lastName`) and the relationship role both optional.

**Architecture:** Three independent slices on the existing Fastify + Prisma/SQLite server and the React + MUI + Cytoscape web app. `lastName` becomes nullable in the DB (mirroring `middleName`); `role` stays `NOT NULL` but accepts `""` so the `@@unique([sourceId, targetId, role])` constraint still forbids duplicate blank arrows; book rename reuses the already-existing `PATCH /api/books/:id` route and surfaces the title through the graph payload.

**Tech Stack:** TypeScript, Fastify 4, Prisma 5, SQLite, Zod, React 18, MUI, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-21-rename-books-optional-fields-design.md`

## Global Constraints

- Name fields cap at **30 chars** (`name30` server, `inputProps={{ maxLength: 30 }}` web); book title caps at **60** (`maxLength: 60`).
- **Empty role is stored as `""`**, never `NULL` — keeps the `@@unique([sourceId, targetId, role])` constraint meaningful (max one blank arrow per source→target pair).
- **Empty surname is stored as `null`** — `lastName` becomes `String?`, the web client sends `lastName.trim() || null` (mirrors `middleName`).
- UI: the now-optional **Фамилия** and **Роль** fields show `helperText` "необязательно" / "Необязательно, …" and drop required-validation.
- Tooling per `CLAUDE.md`: use Serena MCP editing tools, not Edit/Write. Implement with Sonnet/Haiku.
- Run the **full** server suite (`npm run test --workspace server`) — both `relationships.test.ts` and `api.test.ts` exercise the relations wire shape. Run `npm run test --workspace web` and `npx tsc --noEmit -p web/tsconfig.json` after web edits.

---

## Task 1: Make `lastName` optional on the server

**Files:**
- Modify: `server/prisma/schema.prisma` (Character.lastName)
- Modify: `server/src/schemas.ts` (characterCreateSchema.lastName)
- Test: `server/test/api.test.ts`

**Interfaces:**
- Produces: `POST /api/characters` and `PATCH /api/characters/:id` accept a payload with `lastName` omitted/null; the graph node's `lastName` is `null` in that case.

- [ ] **Step 1: Write the failing test**

Add to `server/test/api.test.ts` (after the "creates character with relations" test):

```ts
test("creates a character with no lastName", async () => {
  const book = await createBook();
  const res = await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "Платон", relations: [] },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().lastName).toBeNull();

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes[0]).toMatchObject({ firstName: "Платон", lastName: null });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace server -- api.test`
Expected: FAIL — the request 400s because `lastName` is currently required (`name30`).

- [ ] **Step 3: Make the schema column nullable**

In `server/prisma/schema.prisma`, change the `Character` model line:

```prisma
  lastName   String?
```

- [ ] **Step 4: Relax the Zod schema**

In `server/src/schemas.ts`, in `characterCreateSchema`, change `lastName`:

```ts
  lastName: name30.optional().nullable(),
```

(Leaves `middleName` unchanged — it already reads `name30.optional().nullable()`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace server -- api.test`
Expected: PASS. (`setupTestDb` runs `prisma db push --force-reset`, so the nullable column is applied automatically.)

- [ ] **Step 6: Run the full server suite**

Run: `npm run test --workspace server`
Expected: all PASS (existing tests still send `lastName`, which is still valid).

- [ ] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/src/schemas.ts server/test/api.test.ts
git commit -m "feat(server): make character lastName optional"
```

---

## Task 2: Make `lastName` optional in the web app

**Files:**
- Modify: `web/src/lib/validation.ts`
- Modify: `web/src/types.ts` (Character.lastName)
- Modify: `web/src/api/client.ts` (CharacterInput.lastName)
- Modify: `web/src/components/CharacterModal.tsx` (helperText + submit)
- Modify: `web/src/components/RelationsModal.tsx` (trim name joins)
- Test: `web/src/lib/__tests__/validation.test.ts`

**Interfaces:**
- Consumes: server from Task 1 (accepts `lastName: null`).
- Produces: `CharacterInput.lastName?: string | null`; `Character.lastName?: string | null`.

- [ ] **Step 1: Update the validation test**

In `web/src/lib/__tests__/validation.test.ts`, replace the "requires first and last name" test with:

```ts
test("requires first name, allows empty last name", () => {
  expect(characterFormSchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
  expect(characterFormSchema.safeParse({ ...valid, lastName: "" }).success).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- validation`
Expected: FAIL — `lastName: ""` currently returns `success: false`.

- [ ] **Step 3: Relax the form schema**

In `web/src/lib/validation.ts`, change `lastName` in `characterFormSchema` to mirror `middleName`:

```ts
  lastName: z.string().trim().max(30, "Максимум 30 символов").optional().or(z.literal("")),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- validation`
Expected: PASS.

- [ ] **Step 5: Widen the `lastName` types**

In `web/src/types.ts`, in `interface Character`:

```ts
  lastName?: string | null;
```

In `web/src/api/client.ts`, in `interface CharacterInput`:

```ts
  lastName?: string | null;
```

- [ ] **Step 6: Update the modal field + submit**

In `web/src/components/CharacterModal.tsx`:

- In `submit()`, change the submitted `lastName`:

```ts
      lastName: lastName.trim() || null,
```

- Change the "Фамилия" `TextField` helper text so it reads optional:

```tsx
            <TextField label="Фамилия" value={lastName} inputProps={{ maxLength: 30 }} error={!!errors.lastName}
              helperText={errors.lastName ?? "Необязательно, до 30 символов"} onChange={(e) => setLastName(e.target.value)} />
```

- [ ] **Step 7: Trim the name joins in RelationsModal**

In `web/src/components/RelationsModal.tsx`, replace the body of `nameOf`:

```tsx
  const nameOf = (id: string) => {
    const c = others.find((o) => o.id === id);
    return c ? `${c.firstName} ${c.lastName ?? ""}`.trim() : id;
  };
```

And the dropdown `MenuItem` label:

```tsx
                  {others.map((o) => (
                    <MenuItem key={o.id} value={o.id}>{`${o.firstName} ${o.lastName ?? ""}`.trim()}</MenuItem>
                  ))}
```

- [ ] **Step 8: Run web tests + typecheck**

Run: `npm run test --workspace web`
Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: all PASS, no type errors. (Existing `CharacterModal.test.tsx` still types a surname, so `expect.objectContaining({ lastName: "Петров" })` still holds.)

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/validation.ts web/src/lib/__tests__/validation.test.ts web/src/types.ts web/src/api/client.ts web/src/components/CharacterModal.tsx web/src/components/RelationsModal.tsx
git commit -m "feat(web): make character lastName optional"
```

---

## Task 3: Make `role` optional on the server

**Files:**
- Modify: `server/src/schemas.ts` (relationEntrySchema.role)
- Test: `server/test/relationships.test.ts`

**Interfaces:**
- Produces: `relationEntrySchema` accepts `role: ""`; `reconcileRelationships` already trims/keys by role and stores `""` unchanged.

- [ ] **Step 1: Write the failing test**

`relationships.test.ts` already imports `relationEntrySchema`, `reconcileRelationships`, `prisma`, `DEFAULT_USER_ID` and defines a `seed()` helper — no new imports needed. Append a schema-level check (the one that fails before the change) and a round-trip regression guard:

```ts
test("relationEntrySchema accepts an empty role", () => {
  expect(relationEntrySchema.safeParse({ role: "", targets: [] }).success).toBe(true);
});

test("reconcile stores an empty role as a blank-labelled edge", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace server -- relationships`
Expected: the "accepts an empty role" test FAILS — `role: name30` requires min length 1. (The reconcile round-trip bypasses Zod and may already pass; it stays as a regression guard.)

- [ ] **Step 3: Relax the role schema**

In `server/src/schemas.ts`, change `role` in `relationEntrySchema`:

```ts
  role: z.string().trim().max(30).optional().default(""),
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm run test --workspace server -- relationships`
Expected: PASS (both the blank-edge round-trip and the schema check).

- [ ] **Step 5: Run the full server suite**

Run: `npm run test --workspace server`
Expected: all PASS — confirms `api.test.ts` (which posts the relations shape end-to-end) still parses with the relaxed `role`.

- [ ] **Step 6: Commit**

```bash
git add server/src/schemas.ts server/test/relationships.test.ts
git commit -m "feat(server): allow an empty relationship role"
```

---

## Task 4: Make `role` optional in the web UI

**Files:**
- Modify: `web/src/components/RelationsModal.tsx` (role field helper text)
- Test: `web/src/components/__tests__/RelationsModal.test.tsx`

**Interfaces:**
- Consumes: server from Task 3.
- Produces: a relation entry can be saved with `role: ""`; the canvas already renders an empty `data(label)` as a plain arrow (no code change needed in `graphAdapter.ts`/`MindMap.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `web/src/components/__tests__/RelationsModal.test.tsx`:

```ts
test("saves an entry with an empty role", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  // Leave the role blank, just save.
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ role: "", targets: [] }]);
});

test("the role field is marked optional", async () => {
  render(<RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  expect(screen.getByText(/необязательно/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- RelationsModal`
Expected: the "optional" test FAILS (no "необязательно" text yet). The "empty role" test likely already PASSES (the modal never required a role), confirming behaviour — keep it as a regression guard.

- [ ] **Step 3: Add the optional helper text**

In `web/src/components/RelationsModal.tsx`, on the "Роль" `TextField`, add a helper:

```tsx
                <TextField
                  label="Роль"
                  value={entry.role}
                  inputProps={{ maxLength: 30 }}
                  helperText="Необязательно"
                  onChange={(e) => update(i, { role: e.target.value })}
                  fullWidth
                />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- RelationsModal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/RelationsModal.tsx web/src/components/__tests__/RelationsModal.test.tsx
git commit -m "feat(web): mark relationship role as optional"
```

---

## Task 5: Surface the book title through the graph payload

**Files:**
- Modify: `server/src/services/graph.ts`
- Modify: `web/src/types.ts` (BookGraph)
- Test: `server/test/graph.test.ts`

**Interfaces:**
- Produces: `getBookGraph(bookId)` returns `{ title: string; nodes; edges }`; `BookGraph` gains `title: string`.

- [ ] **Step 1: Update the graph test**

In `server/test/graph.test.ts`, in the existing "returns nodes and edges for a book" test, add a title assertion after the graph is fetched:

```ts
  expect(graph.title).toBe("B");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace server -- graph.test`
Expected: FAIL — `graph.title` is `undefined`.

- [ ] **Step 3: Add the title to the payload**

In `server/src/services/graph.ts`, replace the function body so the book title is fetched alongside the rows:

```ts
export async function getBookGraph(bookId: string) {
  const [book, rows, edges] = await Promise.all([
    prisma.book.findUnique({ where: { id: bookId }, select: { title: true } }),
    prisma.character.findMany({
      where: { bookId },
      orderBy: { createdAt: "asc" },
      include: { avatar: { select: { updatedAt: true } } },
    }),
    prisma.relationship.findMany({ where: { bookId }, orderBy: { createdAt: "asc" } }),
  ]);
  const nodes = rows.map(({ avatar, ...c }) => ({
    ...c,
    avatarUpdatedAt: avatar?.updatedAt ?? null,
  }));
  return { title: book?.title ?? "", nodes, edges };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace server -- graph.test`
Expected: PASS.

- [ ] **Step 5: Add `title` to the web type**

In `web/src/types.ts`, in `interface BookGraph`:

```ts
export interface BookGraph {
  title?: string;
  nodes: Character[];
  edges: Relationship[];
}
```

`title` is **optional** on purpose: `web/tsconfig.json` includes `"src"`, so `tsc` compiles the `__tests__` files, and several existing tests build `BookGraph` literals (graphAdapter, MindMap, BookScreen) without a title. The real server payload always sets it; the only consumer that needs it (Task 6) reads `graph.title ?? ""`.

- [ ] **Step 6: Typecheck the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors — existing test fixtures that omit `title` still compile because the field is optional.

- [ ] **Step 7: Run the full server suite**

Run: `npm run test --workspace server`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/graph.ts server/test/graph.test.ts web/src/types.ts
git commit -m "feat: include book title in the graph payload"
```

---

## Task 6: Book rename — client method, pencil icon, rename dialog

**Files:**
- Modify: `web/src/api/client.ts` (updateBook)
- Modify: `web/src/components/TopBar.tsx` (pencil icon + onEdit prop)
- Modify: `web/src/screens/BookScreen.tsx` (title state, rename dialog)
- Test: `web/src/screens/__tests__/BookScreen.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/books/:id` (already exists, returns the updated `Book`); `BookGraph.title` from Task 5.
- Produces: `api.updateBook(id, title) => Promise<Book>`; `TopBar` accepts `onEdit?: () => void`.

- [ ] **Step 1: Write the failing test**

In `web/src/screens/__tests__/BookScreen.test.tsx`, add `updateBook: vi.fn(),` to the mocked `api` object, give `oneCharacter` a title, and add a rename test:

```ts
// in the api mock object:
    updateBook: vi.fn(),
```

```ts
// give the fixture a title:
const oneCharacter: BookGraph = {
  title: "Война и мир",
  nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30 }],
  edges: [],
};
```

```ts
test("renames the book from the top bar pencil", async () => {
  (api.getGraph as any).mockResolvedValue(oneCharacter);
  (api.updateBook as any).mockResolvedValue({ id: "b1", title: "Анна Каренина", sortOrder: 0 });

  renderBookScreen();

  await userEvent.click(await screen.findByRole("button", { name: /переименовать книгу/i }));
  const field = await screen.findByLabelText(/название/i);
  expect(field).toHaveValue("Война и мир");
  await userEvent.clear(field);
  await userEvent.type(field, "Анна Каренина");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));

  await waitFor(() => expect(api.updateBook).toHaveBeenCalledWith("b1", "Анна Каренина"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- BookScreen`
Expected: FAIL — no "переименовать книгу" button exists.

- [ ] **Step 3: Add the API client method**

In `web/src/api/client.ts`, add to the `api` object (after `deleteBook`):

```ts
  updateBook: (id: string, title: string) =>
    req<Book>(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
```

- [ ] **Step 4: Add the pencil icon to TopBar**

In `web/src/components/TopBar.tsx`, import the edit icon, add the prop, and render the pencil left of the trash:

```tsx
import { AppBar, Toolbar, Typography, IconButton, Box } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

interface Props {
  onBack?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TopBar({ onBack, onEdit, onDelete }: Props) {
  return (
    <AppBar position="sticky" color="primary" sx={{ pt: "env(safe-area-inset-top)" }}>
      <Toolbar>
        <Box sx={{ width: 96 }}>
          {onBack && (
            <IconButton edge="start" color="inherit" aria-label="назад" onClick={onBack}>
              <ArrowBackIcon />
            </IconButton>
          )}
        </Box>
        <Typography variant="h6" sx={{ flex: 1, textAlign: "center" }}>
          Roles Mind Map
        </Typography>
        <Box sx={{ width: 96, textAlign: "right" }}>
          {onEdit && (
            <IconButton color="inherit" aria-label="переименовать книгу" onClick={onEdit}>
              <EditIcon />
            </IconButton>
          )}
          {onDelete && (
            <IconButton edge="end" color="inherit" aria-label="удалить книгу" onClick={onDelete}>
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
```

(The left `Box` width is bumped to 96 to keep the centered title symmetric with the two right-hand icons.)

- [ ] **Step 5: Wire the rename dialog into BookScreen**

In `web/src/screens/BookScreen.tsx`:

- Add `TextField`, `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` to the existing `@mui/material` import.
- Add state and store the title from the graph. Replace the graph/refresh block:

```tsx
  const [graph, setGraph] = useState<BookGraph>({ title: "", nodes: [], edges: [] });
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; character?: Character } | null>(null);
  const [deleteBookOpen, setDeleteBookOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");

  const refresh = () => api.getGraph(bookId!).then((g) => { setGraph(g); setLoaded(true); });
```

- Add a rename handler near `removeBook`:

```tsx
  const renameBook = async () => {
    const trimmed = renameTitle.trim();
    if (!trimmed) return;
    await api.updateBook(bookId!, trimmed);
    setRenameOpen(false);
    await refresh();
  };
```

- Pass `onEdit` to `TopBar`, opening the dialog pre-filled with the current title:

```tsx
      <TopBar
        onBack={() => navigate("/")}
        onEdit={() => { setRenameTitle(graph.title ?? ""); setRenameOpen(true); }}
        onDelete={() => setDeleteBookOpen(true)}
      />
```

- Add the rename `Dialog` next to the existing `ConfirmDialog` (before `</Box>`):

```tsx
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Переименовать книгу</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth label="Название" value={renameTitle} sx={{ mt: 1 }}
            inputProps={{ maxLength: 60 }} onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void renameBook(); }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={() => void renameBook()}>Сохранить</Button>
        </DialogActions>
      </Dialog>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test --workspace web -- BookScreen`
Expected: PASS.

- [ ] **Step 7: Run web tests + typecheck**

Run: `npm run test --workspace web`
Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/api/client.ts web/src/components/TopBar.tsx web/src/screens/BookScreen.tsx web/src/screens/__tests__/BookScreen.test.tsx
git commit -m "feat(web): rename a book from the top bar"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full server suite**

Run: `npm run test --workspace server`
Expected: all PASS.

- [ ] **Step 2: Full web suite**

Run: `npm run test --workspace web`
Expected: all PASS.

- [ ] **Step 3: Web typecheck (the Docker/build path)**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Production build (catches server `tsc` issues)**

Run: `npm run build`
Expected: web bundle + server compile succeed.

- [ ] **Step 5: Manual smoke (optional, requires Docker)**

Run: `docker compose up --build`, then at `http://localhost:3000`: rename a book via the pencil; create a character with no surname (node shows first name only); add a relation with a blank role (canvas shows a bare arrow).
