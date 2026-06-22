# Public Read-Only Book Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a book owner copy a permanent public link that opens a read-only view of that book's mind-map canvas, viewable without login.

**Architecture:** The public link is `<origin>/share/<bookId>` — derived from the always-present `Book.id`, so no schema column or migration is needed. New unauthenticated server routes under `/api/share/*` (exempted from the auth gate) serve the existing graph payload and book-scoped avatar bytes. A new `ShareScreen` (routed outside `AuthGate`) reuses the existing `MindMap` canvas and a new lightweight read-only `CharacterView` card. The owner's `BookScreen` gains a share icon that copies the link and shows a toast.

**Tech Stack:** Fastify 4 + Prisma 5 (SQLite) server; React 18 + TypeScript + MUI + Cytoscape.js (cytoscape-cola) PWA; Vitest + Testing Library; npm workspaces monorepo.

## Global Constraints

- **No Prisma schema change, no migration.** The share link is derived from `Book.id`.
- **Server file navigation/editing** may use plain tools here; tests run via Vitest. The Docker build runs `tsc`, so keep types clean (run `npx tsc --noEmit -p web/tsconfig.json` after large web edits).
- **API client rule:** `web/src/api/client.ts` only sets `Content-Type: application/json` when a body is present. Do not add a blanket content-type header.
- **Auth gate:** every `/api/*` route except `/api/auth/*` (and, after Task 1, `/api/share/*`) requires the signed `rmm_session` cookie. Server tests that hit gated routes obtain a cookie via `signIn(app)` and inject it; public `/api/share/*` requests are made with **no** cookie.
- **Russian UI copy** throughout (matches existing screens).
- Run the **full** `npm run test --workspace server` and `npm run test --workspace web` before declaring done.

---

### Task 1: Server — public share routes + auth-gate exemption

**Files:**
- Create: `server/src/routes/share.ts`
- Modify: `server/src/app.ts` (the `preHandler` gate at lines ~19-23, and route registration at lines ~25-28)
- Test: `server/test/share.test.ts`

**Interfaces:**
- Consumes: `prisma` (`server/src/db.js`), `getBookGraph(bookId)` (`server/src/services/graph.js`), `buildApp` + test helpers `setupTestDb`, `resetData`, `makeApp`, `signIn`, `prisma` (`server/test/helpers.js`).
- Produces:
  - `GET /api/share/:bookId/graph` → `{ title, nodes, edges }` (same shape as `getBookGraph`); `404` if the book does not exist.
  - `GET /api/share/:bookId/characters/:characterId/avatar` → avatar bytes with `Cache-Control: public, max-age=31536000, immutable`; `404` if the character is not in that book or has no avatar.
  - `export async function shareRoutes(app: FastifyInstance): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `server/test/share.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, makeApp, signIn, prisma } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let cookie: string;
beforeAll(async () => { setupTestDb(); app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetData(); cookie = await signIn(app); });

const inject = (opts: Parameters<FastifyInstance["inject"]>[0]) =>
  app.inject({ ...opts, headers: { ...(opts as { headers?: Record<string, string> }).headers, cookie } });

async function seedBookWithCharacter() {
  const book = (await inject({ method: "POST", url: "/api/books", payload: { title: "Shared" } })).json();
  const c = (await inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "Vasya", lastName: "V", relations: [] },
  })).json();
  return { book, c };
}

test("public graph is reachable without a session cookie", async () => {
  const { book } = await seedBookWithCharacter();
  const res = await app.inject({ method: "GET", url: `/api/share/${book.id}/graph` });
  expect(res.statusCode).toBe(200);
  expect(res.json().title).toBe("Shared");
  expect(res.json().nodes).toHaveLength(1);
});

test("public graph returns 404 for an unknown book", async () => {
  const res = await app.inject({ method: "GET", url: "/api/share/does-not-exist/graph" });
  expect(res.statusCode).toBe(404);
});

test("public avatar is reachable without a cookie and is book-scoped", async () => {
  const { book, c } = await seedBookWithCharacter();
  await prisma.characterAvatar.create({
    data: { characterId: c.id, data: Buffer.from([1, 2, 3]), mimeType: "image/webp", width: 512, height: 512 },
  });

  const ok = await app.inject({ method: "GET", url: `/api/share/${book.id}/characters/${c.id}/avatar` });
  expect(ok.statusCode).toBe(200);
  expect(ok.headers["content-type"]).toContain("image/webp");

  const otherBook = (await inject({ method: "POST", url: "/api/books", payload: { title: "Other" } })).json();
  const wrong = await app.inject({ method: "GET", url: `/api/share/${otherBook.id}/characters/${c.id}/avatar` });
  expect(wrong.statusCode).toBe(404);
});

test("public avatar returns 404 when the character has no avatar", async () => {
  const { book, c } = await seedBookWithCharacter();
  const res = await app.inject({ method: "GET", url: `/api/share/${book.id}/characters/${c.id}/avatar` });
  expect(res.statusCode).toBe(404);
});

test("the auth gate still blocks non-share api routes without a cookie", async () => {
  const res = await app.inject({ method: "GET", url: "/api/books" });
  expect(res.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace server -- share`
Expected: FAIL — the `/api/share/*` routes don't exist yet, so graph/avatar requests return `401` (still gated) or `404` from the not-found handler.

- [ ] **Step 3: Create the share routes**

Create `server/src/routes/share.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function shareRoutes(app: FastifyInstance) {
  app.get<{ Params: { bookId: string } }>("/api/share/:bookId/graph", async (req, reply) => {
    const book = await prisma.book.findUnique({ where: { id: req.params.bookId }, select: { id: true } });
    if (!book) return reply.code(404).send({ error: "not found" });
    const { getBookGraph } = await import("../services/graph.js");
    return getBookGraph(req.params.bookId);
  });

  app.get<{ Params: { bookId: string; characterId: string } }>(
    "/api/share/:bookId/characters/:characterId/avatar",
    async (req, reply) => {
      const character = await prisma.character.findUnique({
        where: { id: req.params.characterId },
        select: { bookId: true },
      });
      if (!character || character.bookId !== req.params.bookId) {
        return reply.code(404).send({ error: "not found" });
      }
      const avatar = await prisma.characterAvatar.findUnique({ where: { characterId: req.params.characterId } });
      if (!avatar) return reply.code(404).send({ error: "not found" });
      return reply
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .type(avatar.mimeType)
        .send(avatar.data);
    },
  );
}
```

- [ ] **Step 4: Exempt `/api/share/` from the gate and register the routes**

In `server/src/app.ts`, add the import near the other route imports:

```ts
import { shareRoutes } from "./routes/share.js";
```

Update the gate condition inside the `preHandler` (currently):

```ts
    const isApi = req.url.startsWith("/api/");
    const isAuth = req.url.startsWith("/api/auth/");
    if (isApi && !isAuth && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
```

to:

```ts
    const isApi = req.url.startsWith("/api/");
    const isAuth = req.url.startsWith("/api/auth/");
    const isShare = req.url.startsWith("/api/share/");
    if (isApi && !isAuth && !isShare && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
```

Register the routes alongside the others (after `app.register(relationshipRoutes);`):

```ts
  app.register(shareRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace server -- share`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Run the full server suite (regression guard for the gate change)**

Run: `npm run test --workspace server`
Expected: PASS — existing auth/api tests still green.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/share.ts server/src/app.ts server/test/share.test.ts
git commit -m "feat(server): public read-only share routes for book graph + avatars"
```

---

### Task 2: Web — public API client methods

**Files:**
- Modify: `web/src/api/client.ts` (the `api` object, near `getGraph` and `avatarUrl`)
- Test: `web/src/api/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `req<T>` helper and `BookGraph` type (already in the file).
- Produces:
  - `api.getSharedGraph(bookId: string): Promise<BookGraph>`
  - `api.sharedAvatarUrl(bookId: string, id: string, version: string): string`

- [ ] **Step 1: Write the failing test**

Add to `web/src/api/__tests__/client.test.ts`:

```ts
test("sharedAvatarUrl targets the book-scoped public route with a cache-bust param", () => {
  expect(api.sharedAvatarUrl("b1", "c1", "2026-06-18T00:00:00.000Z")).toBe(
    "/api/share/b1/characters/c1/avatar?v=2026-06-18T00%3A00%3A00.000Z",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- client`
Expected: FAIL — `api.sharedAvatarUrl is not a function`.

- [ ] **Step 3: Add the client methods**

In `web/src/api/client.ts`, add to the `api` object. Place `getSharedGraph` right after `getGraph`:

```ts
  getSharedGraph: (bookId: string) => req<BookGraph>(`/api/share/${bookId}/graph`),
```

and `sharedAvatarUrl` right after `avatarUrl`:

```ts
  sharedAvatarUrl: (bookId: string, id: string, version: string) =>
    `/api/share/${bookId}/characters/${id}/avatar?v=${encodeURIComponent(version)}`,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/api/__tests__/client.test.ts
git commit -m "feat(web): api.getSharedGraph + api.sharedAvatarUrl for the public view"
```

---

### Task 3: Web — parameterize avatar URLs in the reused canvas

**Files:**
- Modify: `web/src/lib/graphAdapter.ts` (the `toElements` function)
- Modify: `web/src/canvas/MindMap.tsx` (`Props` interface, the destructure, and the two `toElements(graph)` call sites)
- Test: `web/src/lib/__tests__/graphAdapter.test.ts`

**Interfaces:**
- Consumes: `api.avatarUrl` (default builder).
- Produces:
  - `toElements(graph: BookGraph, opts?: { avatarUrl?: (id: string, version: string) => string }): CyElement[]` — defaults to `api.avatarUrl`.
  - `MindMap` gains optional prop `avatarUrl?: (id: string, version: string) => string`, forwarded to `toElements`.

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/__tests__/graphAdapter.test.ts`:

```ts
test("toElements uses a custom avatarUrl builder when provided", () => {
  const g: BookGraph = {
    nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "V", avatarUpdatedAt: "2026-06-18T00:00:00.000Z" }],
    edges: [],
  };
  const node = toElements(g, { avatarUrl: (id, v) => `/custom/${id}/${v}` })[0];
  expect(node.data.avatarUri).toBe("/custom/c1/2026-06-18T00:00:00.000Z");
});
```

(If `BookGraph` is not already imported in this test file, add `import type { BookGraph } from "../../types.js";` at the top.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — `toElements` ignores the second argument, so `avatarUri` is the default `/api/characters/...` URL.

- [ ] **Step 3: Parameterize `toElements`**

In `web/src/lib/graphAdapter.ts`, change the signature and the `avatarUri` line. The function becomes:

```ts
export interface ToElementsOptions {
  avatarUrl?: (id: string, version: string) => string;
}

export function toElements(graph: BookGraph, opts: ToElementsOptions = {}): CyElement[] {
  const avatarUrl = opts.avatarUrl ?? api.avatarUrl;
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }

  const nodes: CyElement[] = graph.nodes.map((c) => {
    const el: CyElement = {
      data: {
        id: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join("\n"),
        avatar: avatarKey(c.gender, c.age),
        avatarUri: c.avatarUpdatedAt
          ? avatarUrl(c.id, c.avatarUpdatedAt)
          : "data:image/svg+xml," + encodeURIComponent(avatarSvgMarkup(c.gender, c.age, { sized: true })),
        overlayUri: c.deceased
          ? "data:image/svg+xml," + encodeURIComponent(deceasedOverlaySvg({ sized: true }))
          : null,
        gender: c.gender,
        scale: scaleForDegree(degree.get(c.id) ?? 0),
        edgeScale: edgeScaleForDegree(degree.get(c.id) ?? 0),
      },
    };
    if (c.posX != null && c.posY != null)
      el.position = { x: c.posX * POSITION_SCALE, y: c.posY * POSITION_SCALE };
    return el;
  });

  const edges: CyElement[] = graph.edges.map((e) => ({
    data: { id: e.id, source: e.sourceId, target: e.targetId, label: e.role, color: e.color ?? null },
  }));

  return [...nodes, ...edges];
}
```

(Only the first two lines of the body — the `ToElementsOptions` interface, the new `opts` param, and the `const avatarUrl = ...` line — plus the `avatarUri` change are new. The rest is unchanged.)

- [ ] **Step 4: Thread the builder through `MindMap`**

In `web/src/canvas/MindMap.tsx`:

Add to the `Props` interface:

```ts
  avatarUrl?: (id: string, version: string) => string;
```

Add `avatarUrl` to the destructured params:

```ts
export function MindMap({ graph, onNodeTap, onNodeMoved, onEdgeTap, avatarUrl }: Props) {
```

Change the init-effect call site `elements: toElements(graph),` to:

```ts
      elements: toElements(graph, { avatarUrl }),
```

Change the sync-effect call site `for (const el of toElements(graph)) {` to:

```ts
      for (const el of toElements(graph, { avatarUrl })) {
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace web -- graphAdapter MindMap`
Expected: PASS — the new builder test passes, existing `graphAdapter`/`MindMap` tests (default builder) still pass.

- [ ] **Step 6: Typecheck the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/graphAdapter.ts web/src/canvas/MindMap.tsx web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): parameterize canvas avatar URLs for the public share view"
```

---

### Task 4: Web — read-only `CharacterView` card

**Files:**
- Create: `web/src/components/CharacterView.tsx`
- Test: `web/src/components/__tests__/CharacterView.test.tsx`

**Interfaces:**
- Consumes: `Avatar` (`./Avatar.js`), `useBackClose` (`../lib/useBackClose.js`), `api.avatarUrl` (default), types `Character`, `BookGraph`, `Gender`.
- Produces: `CharacterView` React component:

```ts
interface Props {
  open: boolean;
  character: Character;
  graph: BookGraph;
  avatarUrl?: (id: string, version: string) => string;
  onClose: () => void;
}
```

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/CharacterView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, beforeEach } from "vitest";
import { __resetBackStack } from "../../lib/backStack.js";
import { CharacterView } from "../CharacterView.js";
import type { BookGraph } from "../../types.js";

beforeEach(() => __resetBackStack());

const graph: BookGraph = {
  title: "T",
  nodes: [
    {
      id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30,
      comments: [{ id: "k1", text: "Любит шахматы" }],
    },
    { id: "c2", bookId: "b1", gender: "female", firstName: "Маша", lastName: "Иванова" },
  ],
  edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null }],
};

test("renders character fields, relations, and comments read-only", () => {
  render(<CharacterView open character={graph.nodes[0]} graph={graph} onClose={() => {}} />);

  expect(screen.getByText("Вася Петров")).toBeInTheDocument();
  expect(screen.getByText("Мужчина")).toBeInTheDocument();
  expect(screen.getByText("Маша Иванова — друзья")).toBeInTheDocument();
  expect(screen.getByText("Любит шахматы")).toBeInTheDocument();

  // No editing affordances at all.
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /сохранить|удалить|добавить|изменить/i })).not.toBeInTheDocument();
});

test("shows empty states when there are no relations or comments", () => {
  render(<CharacterView open character={graph.nodes[1]} graph={graph} onClose={() => {}} />);
  expect(screen.getByText(/нет комментариев/i)).toBeInTheDocument();
  // c2 has one relation (to c1), so relations are not empty here:
  expect(screen.getByText("Вася Петров — друзья")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- CharacterView`
Expected: FAIL — `CharacterView` module does not exist.

- [ ] **Step 3: Create the component**

Create `web/src/components/CharacterView.tsx`:

```tsx
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Box, Typography, Divider } from "@mui/material";
import { useBackClose } from "../lib/useBackClose.js";
import { Avatar } from "./Avatar.js";
import { api } from "../api/client.js";
import type { Character, BookGraph, Gender } from "../types.js";

interface Props {
  open: boolean;
  character: Character;
  graph: BookGraph;
  avatarUrl?: (id: string, version: string) => string;
  onClose: () => void;
}

const GENDER_LABEL: Record<Gender, string> = { male: "Мужчина", female: "Женщина" };

export function CharacterView({ open, character, graph, avatarUrl = api.avatarUrl, onClose }: Props) {
  useBackClose(open, onClose);

  const fullName = [character.firstName, character.middleName, character.lastName].filter(Boolean).join(" ");
  const src = character.avatarUpdatedAt ? avatarUrl(character.id, character.avatarUpdatedAt) : null;

  const nameOf = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? [n.firstName, n.lastName].filter(Boolean).join(" ") : id;
  };
  const relations = graph.edges
    .filter((e) => e.sourceId === character.id || e.targetId === character.id)
    .map((e) => {
      const otherId = e.sourceId === character.id ? e.targetId : e.sourceId;
      return { id: e.id, name: nameOf(otherId), role: e.role };
    });
  const comments = character.comments ?? [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Персонаж</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Avatar gender={character.gender} age={character.age ?? null} src={src} deceased={character.deceased} />
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">Пол</Typography>
            <Typography>{GENDER_LABEL[character.gender]}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Имя</Typography>
            <Typography>{fullName}</Typography>
          </Box>
          {character.age != null && (
            <Box>
              <Typography variant="caption" color="text.secondary">Возраст</Typography>
              <Typography>{character.age}</Typography>
            </Box>
          )}
          {character.deceased && <Typography color="text.secondary">Умер</Typography>}

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>Связи ({relations.length})</Typography>
            {relations.length === 0 ? (
              <Typography color="text.secondary">Нет связей</Typography>
            ) : (
              <Stack spacing={0.5}>
                {relations.map((r) => (
                  <Typography key={r.id}>{r.role ? `${r.name} — ${r.role}` : r.name}</Typography>
                ))}
              </Stack>
            )}
          </Box>

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>Комментарии ({comments.length})</Typography>
            {comments.length === 0 ? (
              <Typography color="text.secondary">Нет комментариев</Typography>
            ) : (
              <Stack spacing={1}>
                {comments.map((c, i) => (
                  <Typography key={c.id ?? i} sx={{ whiteSpace: "pre-wrap" }}>{c.text}</Typography>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- CharacterView`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/CharacterView.tsx web/src/components/__tests__/CharacterView.test.tsx
git commit -m "feat(web): read-only CharacterView card for the public share view"
```

---

### Task 5: Web — `ShareScreen` + public route

**Files:**
- Create: `web/src/screens/ShareScreen.tsx`
- Modify: `web/src/App.tsx` (move `BrowserRouter` to the top; add the `/share/:bookId` route outside `AuthGate`)
- Test: `web/src/screens/__tests__/ShareScreen.test.tsx`

**Interfaces:**
- Consumes: `api.getSharedGraph`, `api.sharedAvatarUrl` (Task 2); `MindMap` with `avatarUrl` prop (Task 3); `CharacterView` (Task 4); `TopBar` (no handler props → all icons hidden).
- Produces: `export function ShareScreen()` rendered at `/share/:bookId`.

- [ ] **Step 1: Write the failing test**

Create `web/src/screens/__tests__/ShareScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, test, vi, beforeEach } from "vitest";
import { __resetBackStack } from "../../lib/backStack.js";
import { api } from "../../api/client.js";
import { ShareScreen } from "../ShareScreen.js";
import type { BookGraph } from "../../types.js";

// Cytoscape canvas is unrenderable in jsdom; expose a tap button per node.
vi.mock("../../canvas/MindMap.js", () => ({
  MindMap: ({ graph, onNodeTap }: { graph: BookGraph; onNodeTap: (id: string) => void }) => (
    <div data-testid="mindmap">
      {graph.nodes.map((n) => (
        <button key={n.id} onClick={() => onNodeTap(n.id)}>{`tap-${n.id}`}</button>
      ))}
    </div>
  ),
}));

vi.mock("../../api/client.js", () => ({
  api: {
    getSharedGraph: vi.fn(),
    sharedAvatarUrl: (bookId: string, id: string, v: string) =>
      `/api/share/${bookId}/characters/${id}/avatar?v=${v}`,
    avatarUrl: (id: string, v: string) => `/api/characters/${id}/avatar?v=${v}`,
  },
}));

beforeEach(() => { vi.clearAllMocks(); __resetBackStack(); });

const graph: BookGraph = {
  title: "Война и мир",
  nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30 }],
  edges: [],
};

function renderShare() {
  return render(
    <MemoryRouter initialEntries={["/share/b1"]}>
      <Routes>
        <Route path="/share/:bookId" element={<ShareScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("renders the read-only canvas with no edit affordances and opens the read-only card", async () => {
  (api.getSharedGraph as any).mockResolvedValue(graph);
  renderShare();

  expect(await screen.findByText("Война и мир")).toBeInTheDocument();
  // No add FAB and no top-bar action icons.
  expect(screen.queryByRole("button", { name: /добавить персонажа/i })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /переименовать книгу|удалить книгу|назад|поделиться/i }),
  ).not.toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "tap-c1" }));
  expect(await screen.findByText("Вася Петров")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("shows an invalid-link message when the graph fetch fails", async () => {
  (api.getSharedGraph as any).mockRejectedValue(new Error("404"));
  renderShare();
  expect(await screen.findByText(/ссылка недействительна/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- ShareScreen`
Expected: FAIL — `ShareScreen` module does not exist.

- [ ] **Step 3: Create the screen**

Create `web/src/screens/ShareScreen.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { TopBar } from "../components/TopBar.js";
import { MindMap } from "../canvas/MindMap.js";
import { CharacterView } from "../components/CharacterView.js";
import { api } from "../api/client.js";
import type { BookGraph, Character } from "../types.js";

export function ShareScreen() {
  const { bookId } = useParams();
  const [graph, setGraph] = useState<BookGraph>({ title: "", nodes: [], edges: [] });
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [selected, setSelected] = useState<Character | null>(null);

  useEffect(() => {
    api.getSharedGraph(bookId!)
      .then((g) => { setGraph(g); setStatus("ok"); })
      .catch(() => setStatus("error"));
  }, [bookId]);

  const avatarUrl = useCallback(
    (id: string, version: string) => api.sharedAvatarUrl(bookId!, id, version),
    [bookId],
  );

  if (status === "error") {
    return (
      <Box sx={{ minHeight: "100dvh" }}>
        <TopBar />
        <Box sx={{ minHeight: "70dvh", display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
          <Typography variant="h6" color="text.secondary">Ссылка недействительна</Typography>
        </Box>
      </Box>
    );
  }

  const empty = status === "ok" && graph.nodes.length === 0;

  return (
    <Box sx={{ minHeight: "100dvh", position: "relative" }}>
      <TopBar title={graph.title} />
      {empty ? (
        <Box sx={{ minHeight: "70dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="h5" color="text.secondary">Персонажей пока нет</Typography>
        </Box>
      ) : status === "ok" ? (
        <Box sx={{ position: "absolute", top: 56, left: 0, right: 0, bottom: 0 }}>
          <MindMap
            graph={graph}
            avatarUrl={avatarUrl}
            onNodeTap={(id) => {
              const c = graph.nodes.find((n) => n.id === id);
              if (c) setSelected(c);
            }}
            onNodeMoved={() => {}}
          />
        </Box>
      ) : null}

      {selected && (
        <CharacterView
          open
          character={selected}
          graph={graph}
          avatarUrl={avatarUrl}
          onClose={() => setSelected(null)}
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Add the public route outside `AuthGate`**

Replace the body of `web/src/App.tsx` with:

```tsx
import { ThemeProvider, CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { theme } from "./theme.js";
import { AuthGate } from "./AuthGate.js";
import { BooksScreen } from "./screens/BooksScreen.js";
import { BookScreen } from "./screens/BookScreen.js";
import { ShareScreen } from "./screens/ShareScreen.js";

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/share/:bookId" element={<ShareScreen />} />
          <Route path="/" element={<AuthGate><BooksScreen /></AuthGate>} />
          <Route path="/books/:bookId" element={<AuthGate><BookScreen /></AuthGate>} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
```

(The `/share` route renders without `AuthGate`, so it never calls `api.me()` or shows the login screen. The two authed routes each wrap their screen in `AuthGate`, preserving the login gate. `AuthGate` must therefore accept and render `children` as before — no change needed there.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace web -- ShareScreen`
Expected: PASS (both tests).

- [ ] **Step 6: Typecheck the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/screens/ShareScreen.tsx web/src/App.tsx web/src/screens/__tests__/ShareScreen.test.tsx
git commit -m "feat(web): public read-only ShareScreen at /share/:bookId"
```

---

### Task 6: Web — share button in `TopBar` + copy-link toast in `BookScreen`

**Files:**
- Modify: `web/src/components/TopBar.tsx` (add `onShare?` prop + `ShareIcon`)
- Modify: `web/src/screens/BookScreen.tsx` (wire `onShare` → clipboard + `Snackbar`)
- Test: `web/src/screens/__tests__/BookScreen.test.tsx`

**Interfaces:**
- Consumes: `TopBar` (now with `onShare?: () => void`), `navigator.clipboard.writeText`, MUI `Snackbar`.
- Produces: a `ShareIcon` button (aria-label `"поделиться"`) left of the edit pencil, shown only when `onShare` is provided; `BookScreen` copies `${window.location.origin}/share/${bookId}` and shows a toast.

- [ ] **Step 1: Write the failing test**

Add to `web/src/screens/__tests__/BookScreen.test.tsx`:

```tsx
test("share button copies the public link and shows a toast", async () => {
  (api.getGraph as any).mockResolvedValue(oneCharacter);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  renderBookScreen();

  await userEvent.click(await screen.findByRole("button", { name: /поделиться/i }));

  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/b1`),
  );
  expect(await screen.findByText(/ссылка скопирована/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- BookScreen`
Expected: FAIL — there is no button named "поделиться" yet.

- [ ] **Step 3: Add the share icon to `TopBar`**

In `web/src/components/TopBar.tsx`:

Add the icon import below the other icon imports:

```ts
import ShareIcon from "@mui/icons-material/Share";
```

Add `onShare` to the `Props` interface:

```ts
interface Props {
  title?: string;
  onBack?: () => void;
  onShare?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}
```

Add it to the destructured params:

```ts
export function TopBar({ title, onBack, onShare, onEdit, onDelete }: Props) {
```

Replace the right-hand `Box` (the one with `width: 96, textAlign: "right"`) with a flex box that fits up to three icons and renders `ShareIcon` first:

```tsx
        <Box sx={{ minWidth: 96, display: "flex", justifyContent: "flex-end" }}>
          {onShare && (
            <IconButton color="inherit" aria-label="поделиться" onClick={onShare}>
              <ShareIcon />
            </IconButton>
          )}
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
```

- [ ] **Step 4: Wire the share action + toast in `BookScreen`**

In `web/src/screens/BookScreen.tsx`:

Add `Snackbar` to the MUI import (it already imports `Box`, `Typography`, `Button`, `Dialog`, etc. — add `Snackbar` to that list).

Add a state flag next to the other `useState` hooks (e.g. after `editEdge`):

```ts
  const [copied, setCopied] = useState(false);
```

Add the share handler (e.g. next to `renameBook`):

```ts
  const share = async () => {
    const url = `${window.location.origin}/share/${bookId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — silently ignore.
    }
  };
```

Pass `onShare` to `TopBar` (add the prop to the existing `<TopBar ... />`):

```tsx
      <TopBar
        title={graph.title}
        onBack={() => navigate("/")}
        onShare={() => void share()}
        onEdit={() => { setRenameTitle(graph.title ?? ""); setRenameOpen(true); }}
        onDelete={() => setDeleteBookOpen(true)}
      />
```

Add the `Snackbar` near the end of the returned JSX (e.g. just before the closing `</Box>`):

```tsx
      <Snackbar
        open={copied}
        autoHideDuration={2500}
        onClose={() => setCopied(false)}
        message="Ссылка скопирована"
      />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace web -- BookScreen`
Expected: PASS — including the new share test and all existing BookScreen tests.

- [ ] **Step 6: Typecheck the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/TopBar.tsx web/src/screens/BookScreen.tsx web/src/screens/__tests__/BookScreen.test.tsx
git commit -m "feat(web): share button copies the public link and toasts on BookScreen"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full server suite**

Run: `npm run test --workspace server`
Expected: PASS.

- [ ] **Step 2: Run the full web suite**

Run: `npm run test --workspace web`
Expected: PASS.

- [ ] **Step 3: Typecheck both packages (mirrors the Docker `tsc` build)**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm run build --workspace server`
Expected: no errors. (`npm run build` compiles the server with `tsc`, which dev/Vitest skip — it catches `server.ts`/route type errors.)

- [ ] **Step 4: Manual smoke test (optional, requires Docker)**

Run: `docker compose up --build`, open `http://localhost:3000`, sign in, open a book, click the share icon, confirm the toast, paste the copied URL into a private/incognito window, and verify the read-only canvas loads (no FAB, no top-bar action icons, character cards open read-only).

---

## Self-Review

**Spec coverage:**
- Share icon left of the edit pencil → Task 6. ✓
- Click copies link to clipboard + success toast → Task 6. ✓
- Permanent public URL showing current state, "generated on book creation / backfilled for existing books" → satisfied by deriving the link from `Book.id` (no token/migration; the link implicitly exists for every book). Documented in the plan header and spec. ✓
- Unauthenticated access to the canvas → Task 1 (public routes + gate exemption) + Task 5 (`/share` route outside `AuthGate`). ✓
- Read-only view, all top-bar icons hidden (back/share/edit/delete) + no add FAB → Task 5 (`TopBar` with no handler props, no `AddFab`). ✓
- Tap a character → read-only modal with all fields as-is → Task 4 (`CharacterView`). ✓
- View relations & comments read-only; cannot add/delete/edit relations, comments, or avatars → Task 4 renders them as plain text with no controls; no write endpoints are exposed publicly (Task 1 is read-only GETs only). ✓
- Avatars visible in the public view → Task 1 (book-scoped public avatar route) + Task 2/3 (`sharedAvatarUrl` threaded through the canvas and card). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows full code. ✓

**Type consistency:** `getSharedGraph`/`sharedAvatarUrl` (Task 2) are consumed with matching signatures in Tasks 3–5; `toElements(graph, { avatarUrl })` (Task 3) matches the `ToElementsOptions` shape; `CharacterView` props (Task 4) match its usage in `ShareScreen` (Task 5); `TopBar`'s new `onShare?` (Task 6) matches `BookScreen`'s usage. ✓
