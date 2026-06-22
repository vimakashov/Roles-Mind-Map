# Character Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a «Комментарии (N)» section to a character — a staged list of free-form text notes, edited in a modal and persisted with the character.

**Architecture:** A new `Comment` child table of `Character`. The comment list rides the existing character create/update payload (like `relations`), reconciled server-side in the same transaction, and is embedded per node in the graph payload. The web UI stages comments locally in `CharacterModal` (discarded on Cancel) via a `CommentsModal` list + `CommentEditDialog` editor, mirroring the `RelationsModal` pattern.

**Tech Stack:** Fastify 4, Prisma 5, SQLite, Zod (server); React 18, TypeScript, MUI, Vitest + Testing Library (web).

## Global Constraints

- Comment text: trimmed, `min(1)` (empty/whitespace rejected), `max(2000)`.
- Comments are **staged**, persisted only on character save; Cancel discards.
- Wire item shape: `{ id: string | null, text: string }` — `id` null = create, cuid = existing.
- No migrations: boot-time `prisma db push` applies the schema (additive table, no `--accept-data-loss` needed).
- Reconcile is scoped to `where: { characterId }` so ids can't cross characters.
- Comments never render on the canvas — do not touch `graphAdapter` / `MindMap`.
- Follow existing idioms: `reconcileComments` mirrors `reconcileRelationships`; `CommentsModal` mirrors `RelationsModal`; overlays wire `useBackClose(open, onClose)`.
- After web edits, the build gate is `npx tsc --noEmit -p web/tsconfig.json` (Vitest's esbuild won't catch duplicate import/type errors).

---

### Task 1: Server — `Comment` model, schema, and `reconcileComments` service

**Files:**
- Modify: `server/prisma/schema.prisma` (add `Comment` model + `Character.comments`)
- Modify: `server/src/schemas.ts` (add `commentInputSchema`, `CommentInput` type, `comments` field)
- Create: `server/src/services/comments.ts`
- Modify: `server/test/helpers.ts:resetData` (delete comments between tests)
- Test: `server/test/comments.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  - Prisma `Comment { id, characterId, text, createdAt, updatedAt }`.
  - `commentInputSchema` and `export type CommentInput = { id: string | null; text: string }` from `server/src/schemas.ts`.
  - `characterCreateSchema` / `characterUpdateSchema` gain `comments: CommentInput[]` (defaults to `[]`).
  - `reconcileComments(tx: Prisma.TransactionClient, characterId: string, comments: CommentInput[]): Promise<void>`.

- [ ] **Step 1: Add the `Comment` model to the Prisma schema**

In `server/prisma/schema.prisma`, add `comments Comment[]` to the `Character` model (next to `avatar CharacterAvatar?`), and append this model at the end of the file:

```prisma
model Comment {
  id          String   @id @default(cuid())
  characterId String
  text        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `npm run prisma:generate --workspace server`
Expected: "Generated Prisma Client" — the client now exposes the `comment` delegate.

- [ ] **Step 3: Add `commentInputSchema` and wire it into the character schemas**

In `server/src/schemas.ts`, add after `relationConnectionSchema`:

```ts
export const commentInputSchema = z.object({
  id: z.string().min(1).nullable().optional().default(null),
  text: z.string().trim().min(1).max(2000),
});
```

Add a `comments` field to `characterCreateSchema` (alongside `relations`):

```ts
  comments: z.array(commentInputSchema).default([]),
```

Add the inferred type near the other exports:

```ts
export type CommentInput = z.infer<typeof commentInputSchema>;
```

(`characterUpdateSchema` is derived via `.omit({ bookId: true })`, so it inherits `comments` automatically.)

- [ ] **Step 4: Write the failing test for `reconcileComments`**

Create `server/test/comments.test.ts`:

```ts
import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileComments } from "../src/services/comments.js";
import { commentInputSchema } from "../src/schemas.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seedCharacter() {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "Book" } });
  const character = await prisma.character.create({
    data: { bookId: book.id, gender: "male", firstName: "Vasya", lastName: "X" },
  });
  return { book, character };
}

test("creates a comment from a null-id input", async () => {
  const { character } = await seedCharacter();
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: null, text: "first note" }]),
  );
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe("first note");
});

test("updates text on a matching existing id", async () => {
  const { character } = await seedCharacter();
  const created = await prisma.comment.create({ data: { characterId: character.id, text: "old" } });
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: created.id, text: "new" }]),
  );
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe("new");
});

test("deletes comments absent from the payload", async () => {
  const { character } = await seedCharacter();
  const keep = await prisma.comment.create({ data: { characterId: character.id, text: "keep" } });
  await prisma.comment.create({ data: { characterId: character.id, text: "drop" } });
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: keep.id, text: "keep" }]),
  );
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows.map((r) => r.text)).toEqual(["keep"]);
});

test("an empty payload deletes all comments", async () => {
  const { character } = await seedCharacter();
  await prisma.comment.create({ data: { characterId: character.id, text: "a" } });
  await prisma.$transaction((tx) => reconcileComments(tx, character.id, []));
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows).toHaveLength(0);
});

test("a foreign id is treated as a new comment, never updates another character's row", async () => {
  const { book, character } = await seedCharacter();
  const other = await prisma.character.create({
    data: { bookId: book.id, gender: "male", firstName: "Petya", lastName: "X" },
  });
  const foreign = await prisma.comment.create({ data: { characterId: other.id, text: "theirs" } });
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: foreign.id, text: "mine" }]),
  );
  expect((await prisma.comment.findUnique({ where: { id: foreign.id } }))!.text).toBe("theirs");
  const mine = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(mine).toHaveLength(1);
  expect(mine[0].text).toBe("mine");
});

test("commentInputSchema rejects empty text and caps at 2000 chars", () => {
  expect(commentInputSchema.safeParse({ id: null, text: "   " }).success).toBe(false);
  expect(commentInputSchema.safeParse({ id: null, text: "a".repeat(2001) }).success).toBe(false);
  expect(commentInputSchema.safeParse({ text: "a".repeat(2000) }).success).toBe(true);
});

test("commentInputSchema defaults id to null when omitted", () => {
  const result = commentInputSchema.safeParse({ text: "note" });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.id).toBeNull();
});
```

- [ ] **Step 5: Add the comment cleanup to `resetData`**

In `server/test/helpers.ts`, inside `resetData`, add a line before `await prisma.character.deleteMany();`:

```ts
  await prisma.comment.deleteMany();
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test --workspace server -- comments`
Expected: FAIL — `reconcileComments` is not defined (module `../src/services/comments.js` not found).

- [ ] **Step 7: Implement `reconcileComments`**

Create `server/src/services/comments.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { CommentInput } from "../schemas.js";

type Tx = Prisma.TransactionClient;

/**
 * Makes the comments of `characterId` exactly match `comments`.
 * Inputs with a `null` id (or an id not belonging to this character) are created;
 * inputs whose id matches an existing comment update its text; existing comments
 * absent from the payload are deleted. Scoped to the character so ids can't cross.
 */
export async function reconcileComments(
  tx: Tx,
  characterId: string,
  comments: CommentInput[],
): Promise<void> {
  const existing = await tx.comment.findMany({ where: { characterId } });
  const existingById = new Map(existing.map((c) => [c.id, c]));

  const desiredIds = new Set(
    comments
      .filter((c) => c.id != null && existingById.has(c.id))
      .map((c) => c.id as string),
  );

  const toDelete = existing.filter((c) => !desiredIds.has(c.id));
  if (toDelete.length > 0) {
    await tx.comment.deleteMany({ where: { id: { in: toDelete.map((c) => c.id) } } });
  }

  for (const c of comments) {
    const text = c.text.trim();
    const ex = c.id != null ? existingById.get(c.id) : undefined;
    if (ex) {
      if (ex.text !== text) {
        await tx.comment.update({ where: { id: ex.id }, data: { text } });
      }
    } else {
      await tx.comment.create({ data: { characterId, text } });
    }
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test --workspace server -- comments`
Expected: PASS (all 7 tests).

- [ ] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/src/schemas.ts server/src/services/comments.ts server/test/comments.test.ts server/test/helpers.ts
git commit -m "feat(server): Comment model + reconcileComments service"
```

---

### Task 2: Server — wire comments into character routes and the graph payload

**Files:**
- Modify: `server/src/routes/characters.ts` (call `reconcileComments` in POST + PATCH)
- Modify: `server/src/services/graph.ts` (include comments per node)
- Test: `server/test/api.test.ts` (extend with comment round-trip cases)

**Interfaces:**
- Consumes: `reconcileComments` and the `comments` field on the character schemas (Task 1).
- Produces: graph nodes carry `comments: { id: string; text: string }[]` (ordered by `createdAt asc`); `POST`/`PATCH /api/characters` accept and persist `comments`.

- [ ] **Step 1: Write the failing e2e tests**

In `server/test/api.test.ts`, add these tests at the end of the file:

```ts
test("creates a character with comments and returns them in the graph", async () => {
  const book = await createBook();
  const res = await app.inject({
    method: "POST", url: "/api/characters",
    payload: {
      bookId: book.id, gender: "male", firstName: "Vasya", lastName: "V", relations: [],
      comments: [{ id: null, text: "born in Moscow" }, { id: null, text: "loves chess" }],
    },
  });
  expect(res.statusCode).toBe(201);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  const texts = graph.nodes[0].comments.map((c: { text: string }) => c.text);
  expect(texts).toEqual(["born in Moscow", "loves chess"]);
  expect(typeof graph.nodes[0].comments[0].id).toBe("string");
});

test("updates a comment and deletes another via PATCH reconciliation", async () => {
  const book = await createBook();
  const created = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: {
      bookId: book.id, gender: "male", firstName: "Vasya", lastName: "V", relations: [],
      comments: [{ id: null, text: "keep me" }, { id: null, text: "remove me" }],
    },
  })).json();

  const graph1 = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  const keep = graph1.nodes[0].comments.find((c: { text: string }) => c.text === "keep me");

  await app.inject({
    method: "PATCH", url: `/api/characters/${created.id}`,
    payload: {
      gender: "male", firstName: "Vasya", lastName: "V", relations: [],
      comments: [{ id: keep.id, text: "kept and edited" }],
    },
  });

  const graph2 = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  const texts = graph2.nodes[0].comments.map((c: { text: string }) => c.text);
  expect(texts).toEqual(["kept and edited"]);
});

test("rejects a comment longer than 2000 chars", async () => {
  const book = await createBook();
  const res = await app.inject({
    method: "POST", url: "/api/characters",
    payload: {
      bookId: book.id, gender: "male", firstName: "Vasya", lastName: "V", relations: [],
      comments: [{ id: null, text: "a".repeat(2001) }],
    },
  });
  expect(res.statusCode).toBe(400);
});

test("deletes a character and cascades its comments", async () => {
  const book = await createBook();
  const c = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: {
      bookId: book.id, gender: "male", firstName: "Vasya", lastName: "V", relations: [],
      comments: [{ id: null, text: "note" }],
    },
  })).json();
  await app.inject({ method: "DELETE", url: `/api/characters/${c.id}` });
  expect(await prisma.comment.count()).toBe(0);
});
```

Add `prisma` to the existing import from `./helpers.js` at the top of the file (it currently imports `setupTestDb, resetData, makeApp`):

```ts
import { setupTestDb, resetData, makeApp, prisma } from "./helpers.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace server -- api`
Expected: FAIL — `graph.nodes[0].comments` is undefined (graph doesn't include comments yet; comments aren't persisted).

- [ ] **Step 3: Include comments in the graph query**

In `server/src/services/graph.ts`, change the `prisma.character.findMany` `include` to:

```ts
      include: {
        avatar: { select: { updatedAt: true } },
        comments: { select: { id: true, text: true }, orderBy: { createdAt: "asc" } },
      },
```

The existing `nodes` mapping (`rows.map(({ avatar, ...c }) => ...)`) keeps `comments` on the spread `...c` automatically — no further change needed there.

- [ ] **Step 4: Call `reconcileComments` from both character routes**

In `server/src/routes/characters.ts`:

Add the import near the top:

```ts
import { reconcileComments } from "../services/comments.js";
```

In the `POST /api/characters` handler, change the destructure and transaction body:

```ts
    const { bookId, relations, comments, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.create({ data: { bookId, ...fields } });
      await reconcileRelationships(tx, bookId, c.id, relations);
      await reconcileComments(tx, c.id, comments);
      return c;
    });
```

In the `PATCH /api/characters/:id` handler, change the destructure and transaction body:

```ts
    const { relations, comments, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.update({ where: { id: req.params.id }, data: fields });
      await reconcileRelationships(tx, c.bookId, c.id, relations);
      await reconcileComments(tx, c.id, comments);
      return c;
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace server -- api`
Expected: PASS (existing cases + 4 new ones).

- [ ] **Step 6: Run the full server suite (per the "two places" gotcha)**

Run: `npm run test --workspace server`
Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/characters.ts server/src/services/graph.ts server/test/api.test.ts
git commit -m "feat(server): persist character comments + expose them in the graph"
```

---

### Task 3: Web — types + `CommentEditDialog` editor

**Files:**
- Modify: `web/src/types.ts` (add `CommentItem`, `Character.comments`)
- Modify: `web/src/api/client.ts` (add `comments` to `CharacterInput`)
- Create: `web/src/components/CommentEditDialog.tsx`
- Test: `web/src/components/__tests__/CommentEditDialog.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier web tasks.
- Produces:
  - `export interface CommentItem { id: string | null; text: string }` in `web/src/types.ts`; `Character.comments?: CommentItem[]`.
  - `CharacterInput.comments: CommentItem[]` in `web/src/api/client.ts`.
  - `CommentEditDialog` with props `{ open: boolean; initialText: string; onCancel: () => void; onSave: (text: string) => void }`. Save is disabled while the trimmed text is empty; it calls `onSave(text)` with the raw textarea value.

- [ ] **Step 1: Add the `CommentItem` type and `Character.comments`**

In `web/src/types.ts`, add the interface at the end of the file:

```ts
/** One staged comment: a free-form note. `id` is null until persisted. */
export interface CommentItem {
  id: string | null;
  text: string;
}
```

And add to the `Character` interface (next to `deceased?: boolean;`):

```ts
  comments?: CommentItem[];
```

- [ ] **Step 2: Add `comments` to `CharacterInput`**

In `web/src/api/client.ts`, add `CommentItem` to the type import:

```ts
import type { Book, BookGraph, Character, CommentItem, RelationConnection } from "../types.js";
```

And add to the `CharacterInput` interface (after `relations: RelationConnection[];`):

```ts
  comments: CommentItem[];
```

- [ ] **Step 3: Write the failing test for `CommentEditDialog`**

Create `web/src/components/__tests__/CommentEditDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CommentEditDialog } from "../CommentEditDialog.js";
import { __resetBackStack } from "../../lib/backStack.js";

test("Save is disabled for empty text and enabled after typing", async () => {
  render(<CommentEditDialog open initialText="" onCancel={() => {}} onSave={() => {}} />);
  const save = screen.getByRole("button", { name: /^сохранить$/i });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByRole("textbox"), "hello");
  expect(save).toBeEnabled();
});

test("returns the typed text on save", async () => {
  const onSave = vi.fn();
  render(<CommentEditDialog open initialText="" onCancel={() => {}} onSave={onSave} />);
  await userEvent.type(screen.getByRole("textbox"), "a note");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith("a note");
});

test("pre-fills the field with the initial text for editing", () => {
  render(<CommentEditDialog open initialText="existing" onCancel={() => {}} onSave={() => {}} />);
  expect(screen.getByRole("textbox")).toHaveValue("existing");
});

test("Back button cancels the editor", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<CommentEditDialog open initialText="" onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test --workspace web -- CommentEditDialog`
Expected: FAIL — cannot find module `../CommentEditDialog.js`.

- [ ] **Step 5: Implement `CommentEditDialog`**

Create `web/src/components/CommentEditDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from "@mui/material";

interface Props {
  open: boolean;
  initialText: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}

export function CommentEditDialog({ open, initialText, onCancel, onSave }: Props) {
  const [text, setText] = useState(initialText);

  useEffect(() => { if (open) setText(initialText); }, [open]);
  useBackClose(open, onCancel);

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Комментарий</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          multiline
          minRows={8}
          fullWidth
          value={text}
          inputProps={{ maxLength: 2000 }}
          onChange={(e) => setText(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" disabled={!text.trim()} onClick={() => onSave(text)}>
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test --workspace web -- CommentEditDialog`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/types.ts web/src/api/client.ts web/src/components/CommentEditDialog.tsx web/src/components/__tests__/CommentEditDialog.test.tsx
git commit -m "feat(web): CommentItem type + CommentEditDialog editor"
```

---

### Task 4: Web — `CommentsModal` list

**Files:**
- Create: `web/src/components/CommentsModal.tsx`
- Test: `web/src/components/__tests__/CommentsModal.test.tsx`

**Interfaces:**
- Consumes: `CommentItem` (Task 3), `CommentEditDialog` (Task 3).
- Produces: `CommentsModal` with props `{ open: boolean; value: CommentItem[]; onCancel: () => void; onSave: (comments: CommentItem[]) => void }`. Stages a local copy; row label is `«{i+1}. {preview}»` where `preview` is the trimmed text truncated to 15 chars with a trailing `…` when longer.

- [ ] **Step 1: Write the failing test for `CommentsModal`**

Create `web/src/components/__tests__/CommentsModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CommentsModal } from "../CommentsModal.js";
import type { CommentItem } from "../../types.js";
import { __resetBackStack } from "../../lib/backStack.js";

test("empty state shows the add-comment button", () => {
  render(<CommentsModal open value={[]} onCancel={() => {}} onSave={() => {}} />);
  expect(screen.getByRole("button", { name: /добавить комментарий/i })).toBeInTheDocument();
});

test("adds a comment via the editor and returns it on save", async () => {
  const onSave = vi.fn();
  render(<CommentsModal open value={[]} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: /добавить комментарий/i }));
  await userEvent.type(screen.getByRole("textbox"), "born in Moscow");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // editor save
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // modal save
  expect(onSave).toHaveBeenCalledWith([{ id: null, text: "born in Moscow" }]);
});

test("lists a comment titled with its index and 15-char preview", () => {
  const value: CommentItem[] = [{ id: "c1", text: "a very long comment body here" }];
  render(<CommentsModal open value={value} onCancel={() => {}} onSave={() => {}} />);
  expect(screen.getByText("1. a very long com…")).toBeInTheDocument();
});

test("deletes a comment via its trash button", async () => {
  const onSave = vi.fn();
  const value: CommentItem[] = [{ id: "c1", text: "remove me" }];
  render(<CommentsModal open value={value} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: /удалить комментарий 1/i }));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([]);
});

test("edits an existing comment, preserving its id", async () => {
  const onSave = vi.fn();
  const value: CommentItem[] = [{ id: "c1", text: "old text" }];
  render(<CommentsModal open value={value} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByText("1. old text"));
  const box = screen.getByRole("textbox");
  await userEvent.clear(box);
  await userEvent.type(box, "new text");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // editor save
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // modal save
  expect(onSave).toHaveBeenCalledWith([{ id: "c1", text: "new text" }]);
});

test("Back button cancels the comments modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<CommentsModal open value={[]} onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- CommentsModal`
Expected: FAIL — cannot find module `../CommentsModal.js`.

- [ ] **Step 3: Implement `CommentsModal`**

Create `web/src/components/CommentsModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Box, IconButton, Stack, Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import type { CommentItem } from "../types.js";
import { CommentEditDialog } from "./CommentEditDialog.js";

interface Props {
  open: boolean;
  value: CommentItem[];
  onCancel: () => void;
  onSave: (comments: CommentItem[]) => void;
}

// `null` => editor closed; `{ index: null }` => adding; `{ index: n }` => editing row n.
type Editing = { index: number | null } | null;

function preview(text: string): string {
  const head = text.trim().slice(0, 15);
  return head.length < text.trim().length ? `${head}…` : head;
}

export function CommentsModal({ open, value, onCancel, onSave }: Props) {
  const [rows, setRows] = useState<CommentItem[]>(value);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => { if (open) setRows(value); }, [open]);
  useBackClose(open, onCancel);

  const removeAt = (index: number) =>
    setRows((rs) => rs.filter((_, i) => i !== index));

  const saveEditor = (text: string) => {
    setRows((rs) => {
      if (editing?.index == null) return [...rs, { id: null, text }];
      return rs.map((r, i) => (i === editing.index ? { ...r, text } : r));
    });
    setEditing(null);
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Комментарии</DialogTitle>
      <DialogContent dividers>
        {rows.length === 0 ? (
          <Button onClick={() => setEditing({ index: null })}>Добавить комментарий +</Button>
        ) : (
          <>
            <Stack spacing={1}>
              {rows.map((row, i) => (
                <Stack key={row.id ?? `new-${i}`} direction="row" spacing={1} alignItems="center">
                  <Typography
                    sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                    noWrap
                    onClick={() => setEditing({ index: i })}
                  >
                    {`${i + 1}. ${preview(row.text)}`}
                  </Typography>
                  <IconButton
                    aria-label={`удалить комментарий ${i + 1}`}
                    onClick={() => removeAt(i)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
            <Box>
              <Button sx={{ mt: 2 }} onClick={() => setEditing({ index: null })}>
                + Добавить комментарий
              </Button>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(rows)}>Сохранить</Button>
      </DialogActions>

      <CommentEditDialog
        open={!!editing}
        initialText={editing?.index != null ? rows[editing.index].text : ""}
        onCancel={() => setEditing(null)}
        onSave={saveEditor}
      />
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- CommentsModal`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CommentsModal.tsx web/src/components/__tests__/CommentsModal.test.tsx
git commit -m "feat(web): CommentsModal list with staged add/edit/delete"
```

---

### Task 5: Web — wire comments into `CharacterModal` and `BookScreen`

**Files:**
- Modify: `web/src/components/CharacterModal.tsx` (state, button, render `CommentsModal`)
- Modify: `web/src/screens/BookScreen.tsx` (seed `initial.comments`)
- Modify: `web/src/components/__tests__/CharacterModal.test.tsx` (assert the button count)

**Interfaces:**
- Consumes: `CommentsModal` (Task 4), `CommentItem` (Task 3), `CharacterInput.comments` (Task 3).
- Produces: a «Комментарии (N)» button in `CharacterModal` reflecting the staged count; `submit` includes `comments` in the emitted `CharacterInput`; `BookScreen` seeds `initial.comments` from the graph node.

- [ ] **Step 1: Write the failing test for the comment button count**

In `web/src/components/__tests__/CharacterModal.test.tsx`, add this test. First ensure `CommentItem` is importable and the harness builds a valid `CharacterInput`; follow the file's existing render helper. Add:

```tsx
test("shows the staged comment count on the Комментарии button", () => {
  renderModal({
    initial: {
      gender: "male", firstName: "Vasya", lastName: "V", middleName: "", age: null,
      deceased: false, relations: [],
      comments: [{ id: "c1", text: "one" }, { id: "c2", text: "two" }],
    },
  });
  expect(screen.getByRole("button", { name: /комментарии \(2\)/i })).toBeInTheDocument();
});
```

> Note for the implementer: this assumes a `renderModal(props)` helper already exists in the test file. If the existing tests call `render(<CharacterModal ... />)` directly instead, mirror that exact call shape and pass the same `initial` object shown above. Every `initial` literal in this file now needs a `comments` field — grep the test file for `relations:` and add `comments: []` to each `initial`/`empty` literal that omits it, so the `CharacterInput` type still matches.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- CharacterModal`
Expected: FAIL — no button named «Комментарии (2)» (and possibly type errors on `initial` literals missing `comments`).

- [ ] **Step 3: Add comment state and the button to `CharacterModal`**

In `web/src/components/CharacterModal.tsx`:

Add `CommentItem` to the types import:

```ts
import type { Character, CommentItem, Gender, RelationConnection } from "../types.js";
```

Import the modal:

```ts
import { CommentsModal } from "./CommentsModal.js";
```

Add `comments: []` to the `empty` constant:

```ts
const empty: CharacterInput = {
  gender: "male", firstName: "", lastName: "", middleName: "", age: null, deceased: false, relations: [], comments: [],
};
```

Add state next to `relations` / `relationsOpen`:

```ts
  const [comments, setComments] = useState<CommentItem[]>(initial?.comments ?? empty.comments);
  const [commentsOpen, setCommentsOpen] = useState(false);
```

Add `comments` to the `onSubmit` payload in `submit` (after `relations,`):

```ts
      relations,
      comments,
```

Add the button next to the «Связи» button (inside the same `<Box>` group or a sibling `<Box>`):

```tsx
            <Box>
              <Button variant="outlined" onClick={() => setCommentsOpen(true)}>
                Комментарии ({comments.length})
              </Button>
            </Box>
```

Render the modal next to `<RelationsModal ... />`:

```tsx
      <CommentsModal open={commentsOpen} value={comments}
        onCancel={() => setCommentsOpen(false)}
        onSave={(c) => { setComments(c); setCommentsOpen(false); }} />
```

- [ ] **Step 4: Seed `initial.comments` in `BookScreen`**

In `web/src/screens/BookScreen.tsx`, add to the `initial` object (after `relations: incidentConnections(...)`):

```ts
    comments: modal.character.comments ?? [],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace web -- CharacterModal`
Expected: PASS — including the new count assertion.

- [ ] **Step 6: Run the full web suite**

Run: `npm run test --workspace web`
Expected: PASS — all web tests green (confirms the `comments: []` additions to other `initial` literals compile and run).

- [ ] **Step 7: Run the TypeScript build gate**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no output (exit 0). Fix any `CharacterInput` literal still missing `comments`.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/CharacterModal.tsx web/src/screens/BookScreen.tsx web/src/components/__tests__/CharacterModal.test.tsx
git commit -m "feat(web): Комментарии button in CharacterModal wired through BookScreen"
```

---

### Task 6: Full verification + documentation

**Files:**
- Modify: `CLAUDE.md` (document the comments feature)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: a green full test run and updated project docs.

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS — both `server` and `web` workspaces green.

- [ ] **Step 2: Document the feature in `CLAUDE.md`**

In `CLAUDE.md`, under the Schema paragraph add a sentence describing `Comment`:

```
`Comment` is a 1:N child of `Character` (`onDelete: Cascade`) holding free-form notes (`text`, max 2000). Comments are **staged** in `CharacterModal` and reconciled on character save (like relations), never persisted independently; the graph payload embeds each character's comments (`{ id, text }`, ordered by `createdAt`).
```

And add an architecture note near the relations description:

```
**Character comments** — a «Комментарии (N)» button in `CharacterModal` opens `CommentsModal` (list, mirrors `RelationsModal`): empty state shows «Добавить комментарий +»; each row is `«{i+1}. {first 15 chars}…»` with a trash button; tapping a row opens `CommentEditDialog` (multiline, max 2000) to edit. Edits are staged locally (`CommentItem = { id: string | null; text }`, `id` null = new) and ride the character create/update body; `reconcileComments` (`server/src/services/comments.ts`) creates null-id rows, updates matching ids, deletes the rest — scoped to the character.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document character comments feature"
```

---

## Self-Review Notes

- **Spec coverage:** schema + reconcile (Task 1), routes + graph (Task 2), types + editor (Task 3), list modal (Task 4), CharacterModal/BookScreen wiring (Task 5), tests across Tasks 1–5, docs (Task 6). All spec sections mapped.
- **Type consistency:** `CommentItem { id: string | null; text: string }` (web) and `CommentInput` (server) share the same wire shape; `reconcileComments(tx, characterId, comments)` signature is consistent across Tasks 1, 2, and the docs; `CommentsModal`/`CommentEditDialog` prop names match between definition (Tasks 3–4) and usage (Task 5).
- **Staging fidelity:** new comments carry `id: null` and are created server-side; existing ones keep their cuid and are updated; absence = delete — matching the relations reconcile model.
