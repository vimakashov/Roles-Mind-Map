# Roles Mind Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PWA that lets a user create books, add characters with directed labeled relationships, and view them as an interactive mind-map graph — all served from a single Docker image with a SQLite database.

**Architecture:** npm-workspaces monorepo. `server/` is a Fastify + Prisma + SQLite REST API that, in production, also serves the built `web/` static bundle. `web/` is a React + TypeScript + MUI PWA (vite-plugin-pwa) rendering the graph with Cytoscape.js. A directed `relationships` edge means "source is `role` of target" ("Я — [роль] для выбранных"). All queries are scoped by a `user_id` that currently resolves to one default user.

**Tech Stack:** TypeScript everywhere. Backend: Node 20, Fastify, Prisma, SQLite, Zod, Vitest (via `app.inject`). Frontend: React 18, Vite, MUI, Cytoscape.js + cytoscape-cola, react-router, Vitest + React Testing Library. E2E: Playwright. Docker multi-stage build.

**Spec:** `docs/superpowers/specs/2026-06-16-roles-mind-map-design.md`

**Conventions for every task:** Commit messages use Conventional Commits. Run commands from the repo root unless stated. The work happens on branch `design/roles-mind-map` (already checked out) or a worktree created by the executing skill.

---

## File Structure

**Root**
- `package.json` — npm workspaces (`server`, `web`), shared scripts
- `.dockerignore`, `Dockerfile`, `docker-compose.yml`
- `.gitignore` — extend with `node_modules`, `dist`, `*.db`, `web/dev-dist`

**server/** (REST API + static host)
- `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- `server/prisma/schema.prisma` — `User`, `Book`, `Character`, `Relationship`
- `server/src/db.ts` — Prisma client singleton
- `server/src/defaultUser.ts` — `ensureDefaultUser()`
- `server/src/schemas.ts` — Zod request schemas + inferred types
- `server/src/services/relationships.ts` — `reconcileRelationships()` (pure-on-data, runs in a tx)
- `server/src/services/graph.ts` — `getBookGraph()`
- `server/src/routes/books.ts`, `server/src/routes/characters.ts`
- `server/src/app.ts` — `buildApp()` (registers routes; serves static in prod)
- `server/src/server.ts` — entry: migrate, ensure user, listen
- `server/test/helpers.ts` — test app + db reset
- `server/test/*.test.ts`

**web/** (React PWA)
- `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/vitest.config.ts`, `web/src/setupTests.ts`
- `web/src/types.ts` — `Gender`, `Character`, `Relationship`, `BookGraph`, `RelationEntry`
- `web/src/theme.ts` — MUI theme (palette C)
- `web/src/lib/ageStage.ts` — `ageStage(age)`
- `web/src/lib/avatar.ts` — `avatarKey(gender, age)`
- `web/src/lib/relations.ts` — `groupEdges()`, `expandEntries()`
- `web/src/lib/graphAdapter.ts` — `toElements(graph)`
- `web/src/lib/validation.ts` — Zod schemas mirroring server
- `web/src/api/client.ts` — typed fetch wrapper
- `web/src/components/CharacterModal.tsx`, `web/src/components/RelationsModal.tsx`, `web/src/components/TopBar.tsx`, `web/src/components/AddFab.tsx`, `web/src/components/ConfirmDialog.tsx`, `web/src/components/Avatar.tsx`
- `web/src/screens/BooksScreen.tsx`, `web/src/screens/BookScreen.tsx`
- `web/src/canvas/MindMap.tsx`
- `web/src/App.tsx`, `web/src/main.tsx`
- `web/src/**/__tests__/*.test.ts(x)`

**e2e/**
- `playwright.config.ts`, `e2e/happy-path.spec.ts`

---

## Phase 0 — Repo scaffolding

### Task 0.1: Root workspace

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "roles-mind-map",
  "private": true,
  "workspaces": ["server", "web"],
  "scripts": {
    "test": "npm run test --workspace server && npm run test --workspace web",
    "build": "npm run build --workspace web && npm run build --workspace server",
    "dev:server": "npm run dev --workspace server",
    "dev:web": "npm run dev --workspace web"
  }
}
```

- [ ] **Step 2: Extend `.gitignore`**

Append these lines (the file already contains `.superpowers/`):

```gitignore
node_modules/
dist/
*.db
*.db-journal
web/dev-dist/
playwright-report/
test-results/
```

- [ ] **Step 3: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: root npm workspace + gitignore"
```

---

## Phase 1 — Backend foundation

### Task 1.1: Server package + Prisma schema

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/prisma/schema.prisma`, `server/.env`

- [ ] **Step 1: `server/package.json`**

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "prisma:push": "prisma db push",
    "prisma:generate": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/static": "^7.0.4",
    "@prisma/client": "^5.18.0",
    "fastify": "^4.28.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "prisma": "^5.18.0",
    "tsx": "^4.16.5",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `server/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  books     Book[]
}

model Book {
  id        String   @id @default(cuid())
  userId    String
  title     String
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  characters Character[]
  relationships Relationship[]
}

model Character {
  id         String   @id @default(cuid())
  bookId     String
  gender     String   // 'male' | 'female'
  firstName  String
  lastName   String
  middleName String?
  age        Int?
  posX       Float?
  posY       Float?
  createdAt  DateTime @default(now())
  book       Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  outgoing   Relationship[] @relation("source")
  incoming   Relationship[] @relation("target")
}

model Relationship {
  id        String   @id @default(cuid())
  bookId    String
  sourceId  String
  targetId  String
  role      String
  createdAt DateTime @default(now())
  book      Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  source    Character @relation("source", fields: [sourceId], references: [id], onDelete: Cascade)
  target    Character @relation("target", fields: [targetId], references: [id], onDelete: Cascade)

  @@unique([sourceId, targetId, role])
}
```

- [ ] **Step 4: `server/.env`**

```
DATABASE_URL="file:./dev.db"
```

- [ ] **Step 5: Install deps and generate client**

Run: `npm install` (root) then `npm run prisma:generate --workspace server && npm run prisma:push --workspace server`
Expected: Prisma generates client; `server/prisma/dev.db` created with four tables.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/tsconfig.json server/prisma/schema.prisma server/.env package-lock.json
git commit -m "feat(server): prisma schema + package setup"
```

### Task 1.2: Prisma client + default user

**Files:**
- Create: `server/src/db.ts`, `server/src/defaultUser.ts`

- [ ] **Step 1: `server/src/db.ts`**

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

- [ ] **Step 2: `server/src/defaultUser.ts`**

```ts
import { prisma } from "./db.js";

export const DEFAULT_USER_ID = "default-user";

/** Ensures the single local user exists and returns its id. */
export async function ensureDefaultUser(): Promise<string> {
  await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: { id: DEFAULT_USER_ID, name: "Local user" },
  });
  return DEFAULT_USER_ID;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/db.ts server/src/defaultUser.ts
git commit -m "feat(server): prisma client + default user"
```

### Task 1.3: Zod request schemas

**Files:**
- Create: `server/src/schemas.ts`

- [ ] **Step 1: `server/src/schemas.ts`**

```ts
import { z } from "zod";

const name30 = z.string().trim().min(1).max(30);

export const bookCreateSchema = z.object({ title: name30 });
export const bookUpdateSchema = z.object({ title: name30 });

export const relationEntrySchema = z.object({
  role: name30,
  targetIds: z.array(z.string().min(1)),
});

export const characterCreateSchema = z.object({
  bookId: z.string().min(1),
  gender: z.enum(["male", "female"]),
  firstName: name30,
  lastName: name30,
  middleName: name30.optional().nullable(),
  age: z.number().int().min(0).max(100).optional().nullable(),
  relations: z.array(relationEntrySchema).default([]),
});

export const characterUpdateSchema = characterCreateSchema.omit({ bookId: true });

export const positionSchema = z.object({
  posX: z.number(),
  posY: z.number(),
});

export type RelationEntry = z.infer<typeof relationEntrySchema>;
export type CharacterCreate = z.infer<typeof characterCreateSchema>;
export type CharacterUpdate = z.infer<typeof characterUpdateSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/schemas.ts
git commit -m "feat(server): zod request schemas"
```

### Task 1.4: Vitest harness (test app + db reset)

**Files:**
- Create: `server/vitest.config.ts`, `server/test/helpers.ts`, `server/.env.test`

- [ ] **Step 1: `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: [],
  },
});
```

- [ ] **Step 2: `server/.env.test`**

```
DATABASE_URL="file:./test.db"
```

- [ ] **Step 3: `server/test/helpers.ts`**

```ts
import { execSync } from "node:child_process";
import { prisma } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { ensureDefaultUser } from "../src/defaultUser.js";

let pushed = false;

/** Push schema to the test db once per process. */
export function setupTestDb() {
  if (!pushed) {
    execSync("prisma db push --force-reset --skip-generate", {
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
    });
    pushed = true;
  }
}

/** Delete all rows between tests, preserving the default user. */
export async function resetData() {
  await prisma.relationship.deleteMany();
  await prisma.character.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
  await ensureDefaultUser();
}

export async function makeApp() {
  const app = buildApp();
  await app.ready();
  return app;
}

export { prisma };
```

Note: `buildApp` and routes are created in later tasks; this file will not compile until Task 1.7. That is expected — tests referencing it run after Task 1.7.

- [ ] **Step 4: Commit**

```bash
git add server/vitest.config.ts server/.env.test server/test/helpers.ts
git commit -m "test(server): vitest harness + db reset helpers"
```

### Task 1.5: Relationship reconciliation service (TDD)

The core domain logic. Given a character and a desired list of `RelationEntry`, expand to `(sourceId, targetId, role)` rows, diff against existing rows for that source, and apply the minimal create/delete set. Self-relations (target === source) are dropped.

**Files:**
- Create: `server/src/services/relationships.ts`
- Test: `server/test/relationships.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileRelationships } from "../src/services/relationships.js";
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
      { role: "сын", targetIds: [petya.id, zhanna.id] },
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
      { role: "сын", targetIds: [petya.id] },
    ]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targetIds: [zhanna.id] },
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
      { role: "self", targetIds: [vasya.id] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(0);
});

test("dedupes identical (target, role) pairs across entries", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targetIds: [petya.id] },
      { role: "сын", targetIds: [petya.id] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace server -- relationships`
Expected: FAIL — cannot find module `../src/services/relationships.js`.

- [ ] **Step 3: Implement `server/src/services/relationships.ts`**

```ts
import type { Prisma } from "@prisma/client";
import type { RelationEntry } from "../schemas.js";

type Tx = Prisma.TransactionClient;

const key = (targetId: string, role: string) => `${targetId} ${role}`;

/**
 * Makes the relationships for `sourceId` exactly match `entries`.
 * Each entry expands to one row per target. Self-targets are ignored.
 * Applies the minimal set of creates/deletes.
 */
export async function reconcileRelationships(
  tx: Tx,
  bookId: string,
  sourceId: string,
  entries: RelationEntry[],
): Promise<void> {
  const desired = new Map<string, { targetId: string; role: string }>();
  for (const entry of entries) {
    const role = entry.role.trim();
    for (const targetId of entry.targetIds) {
      if (targetId === sourceId) continue;
      desired.set(key(targetId, role), { targetId, role });
    }
  }

  const existing = await tx.relationship.findMany({ where: { sourceId } });
  const existingKeys = new Set(existing.map((r) => key(r.targetId, r.role)));

  const toDelete = existing.filter((r) => !desired.has(key(r.targetId, r.role)));
  if (toDelete.length > 0) {
    await tx.relationship.deleteMany({
      where: { id: { in: toDelete.map((r) => r.id) } },
    });
  }

  const toCreate = [...desired.entries()]
    .filter(([k]) => !existingKeys.has(k))
    .map(([, v]) => ({ bookId, sourceId, targetId: v.targetId, role: v.role }));
  if (toCreate.length > 0) {
    await tx.relationship.createMany({ data: toCreate });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace server -- relationships`
Expected: PASS (4 tests). Note `buildApp` import in helpers may break compile — if so, complete Task 1.7 first, then return here. To unblock now, temporarily comment the `buildApp`/`makeApp` lines in `helpers.ts`; restore in Task 1.7.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/relationships.ts server/test/relationships.test.ts
git commit -m "feat(server): relationship reconciliation service"
```

### Task 1.6: Graph service (TDD)

**Files:**
- Create: `server/src/services/graph.ts`
- Test: `server/test/graph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { getBookGraph } from "../src/services/graph.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

test("returns nodes and edges for a book", async () => {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "B" } });
  const a = await prisma.character.create({ data: { bookId: book.id, gender: "male", firstName: "A", lastName: "A" } });
  const b = await prisma.character.create({ data: { bookId: book.id, gender: "female", firstName: "B", lastName: "B" } });
  await prisma.relationship.create({ data: { bookId: book.id, sourceId: a.id, targetId: b.id, role: "муж" } });

  const graph = await getBookGraph(book.id);
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0]).toMatchObject({ sourceId: a.id, targetId: b.id, role: "муж" });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace server -- graph`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/services/graph.ts`**

```ts
import { prisma } from "../db.js";

export async function getBookGraph(bookId: string) {
  const [nodes, edges] = await Promise.all([
    prisma.character.findMany({ where: { bookId }, orderBy: { createdAt: "asc" } }),
    prisma.relationship.findMany({ where: { bookId }, orderBy: { createdAt: "asc" } }),
  ]);
  return { nodes, edges };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace server -- graph`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/graph.ts server/test/graph.test.ts
git commit -m "feat(server): book graph service"
```

### Task 1.7: Routes + app (TDD via app.inject)

**Files:**
- Create: `server/src/routes/books.ts`, `server/src/routes/characters.ts`, `server/src/app.ts`
- Test: `server/test/api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, makeApp } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { setupTestDb(); app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => resetData());

async function createBook(title = "War and Peace") {
  const res = await app.inject({ method: "POST", url: "/api/books", payload: { title } });
  expect(res.statusCode).toBe(201);
  return res.json();
}

test("creates and lists books", async () => {
  await createBook();
  const res = await app.inject({ method: "GET", url: "/api/books" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toHaveLength(1);
});

test("rejects empty book title", async () => {
  const res = await app.inject({ method: "POST", url: "/api/books", payload: { title: "" } });
  expect(res.statusCode).toBe(400);
});

test("creates character with relations and returns graph", async () => {
  const book = await createBook();
  const petya = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "Petya", lastName: "P", relations: [] },
  })).json();

  const vasyaRes = await app.inject({
    method: "POST", url: "/api/characters",
    payload: {
      bookId: book.id, gender: "male", firstName: "Vasya", lastName: "V",
      relations: [{ role: "сын", targetIds: [petya.id] }],
    },
  });
  expect(vasyaRes.statusCode).toBe(201);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(1);
});

test("updates character relations via reconciliation", async () => {
  const book = await createBook();
  const t = (n: string) => app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: n, lastName: "X", relations: [] },
  }).then((r) => r.json());
  const a = await t("A"); const b = await t("B");
  const v = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "V", lastName: "X", relations: [{ role: "друг", targetIds: [a.id] }] },
  })).json();

  await app.inject({
    method: "PATCH", url: `/api/characters/${v.id}`,
    payload: { gender: "male", firstName: "V", lastName: "X", relations: [{ role: "друг", targetIds: [b.id] }] },
  });

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0].targetId).toBe(b.id);
});

test("deletes character and cascades its edges", async () => {
  const book = await createBook();
  const a = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "A", lastName: "X", relations: [] } })).json();
  const b = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "female", firstName: "B", lastName: "X", relations: [{ role: "жена", targetIds: [a.id] }] } })).json();

  const del = await app.inject({ method: "DELETE", url: `/api/characters/${a.id}` });
  expect(del.statusCode).toBe(204);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes).toHaveLength(1);
  expect(graph.edges).toHaveLength(0);
});

test("saves node position", async () => {
  const book = await createBook();
  const a = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "A", lastName: "X", relations: [] } })).json();
  const res = await app.inject({ method: "PATCH", url: `/api/characters/${a.id}/pos`, payload: { posX: 12, posY: 34 } });
  expect(res.statusCode).toBe(200);
  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes[0]).toMatchObject({ posX: 12, posY: 34 });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace server -- api`
Expected: FAIL — `buildApp` not found.

- [ ] **Step 3: Implement `server/src/routes/books.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { DEFAULT_USER_ID } from "../defaultUser.js";
import { bookCreateSchema, bookUpdateSchema } from "../schemas.js";

export async function bookRoutes(app: FastifyInstance) {
  app.get("/api/books", async () =>
    prisma.book.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  );

  app.post("/api/books", async (req, reply) => {
    const parsed = bookCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const count = await prisma.book.count({ where: { userId: DEFAULT_USER_ID } });
    const book = await prisma.book.create({
      data: { userId: DEFAULT_USER_ID, title: parsed.data.title, sortOrder: count },
    });
    return reply.code(201).send(book);
  });

  app.patch<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    const parsed = bookUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const book = await prisma.book.update({ where: { id: req.params.id }, data: parsed.data });
    return book;
  });

  app.delete<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    await prisma.book.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/books/:id/graph", async (req) => {
    const { getBookGraph } = await import("../services/graph.js");
    return getBookGraph(req.params.id);
  });
}
```

- [ ] **Step 4: Implement `server/src/routes/characters.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { reconcileRelationships } from "../services/relationships.js";
import { characterCreateSchema, characterUpdateSchema, positionSchema } from "../schemas.js";

export async function characterRoutes(app: FastifyInstance) {
  app.post("/api/characters", async (req, reply) => {
    const parsed = characterCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { bookId, relations, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.create({ data: { bookId, ...fields } });
      await reconcileRelationships(tx, bookId, c.id, relations);
      return c;
    });
    return reply.code(201).send(character);
  });

  app.patch<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    const parsed = characterUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { relations, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.update({ where: { id: req.params.id }, data: fields });
      await reconcileRelationships(tx, c.bookId, c.id, relations);
      return c;
    });
    return character;
  });

  app.patch<{ Params: { id: string } }>("/api/characters/:id/pos", async (req, reply) => {
    const parsed = positionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return prisma.character.update({ where: { id: req.params.id }, data: parsed.data });
  });

  app.delete<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    await prisma.character.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 5: Implement `server/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { bookRoutes } from "./routes/books.js";
import { characterRoutes } from "./routes/characters.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(bookRoutes);
  app.register(characterRoutes);
  return app;
}
```

- [ ] **Step 6: Restore `makeApp`/`buildApp` lines in `server/test/helpers.ts`** (if commented in Task 1.5).

- [ ] **Step 7: Run to verify pass**

Run: `npm run test --workspace server`
Expected: PASS — all api/graph/relationships tests green.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes server/src/app.ts server/test/api.test.ts server/test/helpers.ts
git commit -m "feat(server): books + characters REST routes"
```

### Task 1.8: Server entry + static hosting

**Files:**
- Create: `server/src/server.ts`

- [ ] **Step 1: Implement `server/src/server.ts`**

```ts
import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { ensureDefaultUser } from "./defaultUser.js";

async function main() {
  // Apply schema to the (possibly empty) database on the volume.
  execSync("prisma migrate deploy || prisma db push --skip-generate", { stdio: "inherit" });
  await ensureDefaultUser();

  const app = buildApp();

  const webDist = path.resolve(process.cwd(), "public");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Roles Mind Map server listening on :${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test locally**

Run: `npm run dev --workspace server` then in another shell `curl -s localhost:3000/api/books`
Expected: `[]` and the server logs the listening message. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add server/src/server.ts
git commit -m "feat(server): entry point with migrations + static hosting"
```

---

## Phase 2 — Frontend pure logic (TDD)

### Task 2.1: Web package + Vite + test setup

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/src/setupTests.ts`, `web/src/main.tsx`, `web/src/App.tsx`

- [ ] **Step 1: `web/package.json`**

```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@emotion/react": "^11.13.0",
    "@emotion/styled": "^11.13.0",
    "@mui/icons-material": "^5.16.7",
    "@mui/material": "^5.16.7",
    "cytoscape": "^3.30.2",
    "cytoscape-cola": "^2.5.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/cytoscape": "^3.21.6",
    "@types/react": "^18.3.4",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vite-plugin-pwa": "^0.20.1",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Roles Mind Map",
        short_name: "Roles",
        theme_color: "#dcb6b6",
        background_color: "#faf6f5",
        display: "standalone",
        icons: [],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:3000" } },
  build: { outDir: "dist" },
});
```

- [ ] **Step 4: `web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
});
```

- [ ] **Step 5: `web/src/setupTests.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: `web/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Roles Mind Map</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: `web/src/App.tsx`** (placeholder, replaced in Task 3.6)

```tsx
export default function App() {
  return <div>Roles Mind Map</div>;
}
```

- [ ] **Step 8: `web/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 9: Install + sanity build**

Run: `npm install` (root) then `npm run build --workspace web`
Expected: build succeeds, `web/dist` produced.

- [ ] **Step 10: Commit**

```bash
git add web package-lock.json
git commit -m "feat(web): vite + react + mui + pwa scaffold"
```

### Task 2.2: Shared types

**Files:**
- Create: `web/src/types.ts`

- [ ] **Step 1: `web/src/types.ts`**

```ts
export type Gender = "male" | "female";

export interface Book {
  id: string;
  title: string;
  sortOrder: number;
}

export interface Character {
  id: string;
  bookId: string;
  gender: Gender;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  age?: number | null;
  posX?: number | null;
  posY?: number | null;
}

export interface Relationship {
  id: string;
  bookId: string;
  sourceId: string;
  targetId: string;
  role: string;
}

export interface BookGraph {
  nodes: Character[];
  edges: Relationship[];
}

/** UI-level grouping: one role with its selected targets. */
export interface RelationEntry {
  role: string;
  targetIds: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types.ts
git commit -m "feat(web): shared types"
```

### Task 2.3: Age stage + avatar selection (TDD)

**Files:**
- Create: `web/src/lib/ageStage.ts`, `web/src/lib/avatar.ts`
- Test: `web/src/lib/__tests__/avatar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { ageStage } from "../ageStage.js";
import { avatarKey } from "../avatar.js";

describe("ageStage", () => {
  test("buckets", () => {
    expect(ageStage(5)).toBe("child");
    expect(ageStage(10)).toBe("child");
    expect(ageStage(11)).toBe("teen");
    expect(ageStage(17)).toBe("teen");
    expect(ageStage(18)).toBe("adult");
    expect(ageStage(50)).toBe("adult");
    expect(ageStage(51)).toBe("old");
    expect(ageStage(99)).toBe("old");
  });
  test("missing age defaults to adult", () => {
    expect(ageStage(null)).toBe("adult");
    expect(ageStage(undefined)).toBe("adult");
  });
});

describe("avatarKey", () => {
  test("combines gender and stage", () => {
    expect(avatarKey("male", 8)).toBe("male-child");
    expect(avatarKey("female", null)).toBe("female-adult");
    expect(avatarKey("female", 70)).toBe("female-old");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace web -- avatar`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `web/src/lib/ageStage.ts`**

```ts
export type AgeStage = "child" | "teen" | "adult" | "old";

export function ageStage(age: number | null | undefined): AgeStage {
  if (age == null) return "adult";
  if (age <= 10) return "child";
  if (age <= 17) return "teen";
  if (age <= 50) return "adult";
  return "old";
}
```

- [ ] **Step 4: Implement `web/src/lib/avatar.ts`**

```ts
import type { Gender } from "../types.js";
import { ageStage } from "./ageStage.js";

export type AvatarKey = `${Gender}-${ReturnType<typeof ageStage>}`;

export function avatarKey(gender: Gender, age: number | null | undefined): AvatarKey {
  return `${gender}-${ageStage(age)}` as AvatarKey;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test --workspace web -- avatar`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/ageStage.ts web/src/lib/avatar.ts web/src/lib/__tests__/avatar.test.ts
git commit -m "feat(web): age-stage + avatar selection"
```

### Task 2.4: Relation grouping/expansion (TDD)

`groupEdges` turns the flat relationship rows of one source into UI `RelationEntry[]` (grouped by role). `expandEntries` is the inverse, used to predict the payload. Both must round-trip.

**Files:**
- Create: `web/src/lib/relations.ts`
- Test: `web/src/lib/__tests__/relations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { groupEdges, expandEntries } from "../relations.js";
import type { Relationship } from "../../types.js";

const edge = (sourceId: string, targetId: string, role: string): Relationship => ({
  id: `${sourceId}-${targetId}-${role}`, bookId: "b", sourceId, targetId, role,
});

test("groups a source's edges by role", () => {
  const edges = [edge("v", "p", "сын"), edge("v", "z", "сын"), edge("v", "e", "муж")];
  const entries = groupEdges("v", edges);
  expect(entries).toEqual([
    { role: "сын", targetIds: ["p", "z"] },
    { role: "муж", targetIds: ["e"] },
  ]);
});

test("ignores edges where the character is the target", () => {
  const edges = [edge("x", "v", "друг")];
  expect(groupEdges("v", edges)).toEqual([]);
});

test("expandEntries flattens to (targetId, role) pairs", () => {
  const pairs = expandEntries([{ role: "сын", targetIds: ["p", "z"] }]);
  expect(pairs).toEqual([
    { targetId: "p", role: "сын" },
    { targetId: "z", role: "сын" },
  ]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace web -- relations`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/relations.ts`**

```ts
import type { Relationship, RelationEntry } from "../types.js";

/** Group a single source character's outgoing edges into role-keyed entries (insertion order). */
export function groupEdges(sourceId: string, edges: Relationship[]): RelationEntry[] {
  const byRole = new Map<string, string[]>();
  for (const e of edges) {
    if (e.sourceId !== sourceId) continue;
    const list = byRole.get(e.role) ?? [];
    list.push(e.targetId);
    byRole.set(e.role, list);
  }
  return [...byRole.entries()].map(([role, targetIds]) => ({ role, targetIds }));
}

export function expandEntries(entries: RelationEntry[]): { targetId: string; role: string }[] {
  return entries.flatMap((entry) =>
    entry.targetIds.map((targetId) => ({ targetId, role: entry.role })),
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace web -- relations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/relations.ts web/src/lib/__tests__/relations.test.ts
git commit -m "feat(web): relation grouping/expansion"
```

### Task 2.5: Cytoscape element adapter (TDD)

**Files:**
- Create: `web/src/lib/graphAdapter.ts`
- Test: `web/src/lib/__tests__/graphAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { toElements } from "../graphAdapter.js";
import type { BookGraph } from "../../types.js";

const graph: BookGraph = {
  nodes: [
    { id: "v", bookId: "b", gender: "male", firstName: "Вася", lastName: "В", age: 30, posX: 10, posY: 20 },
    { id: "p", bookId: "b", gender: "male", firstName: "Петя", lastName: "П", age: 70 },
  ],
  edges: [{ id: "e1", bookId: "b", sourceId: "v", targetId: "p", role: "сын" }],
};

test("maps nodes with label, avatar key and saved position", () => {
  const els = toElements(graph);
  const vNode = els.find((e) => e.data.id === "v")!;
  expect(vNode.data.label).toBe("Вася В");
  expect(vNode.data.avatar).toBe("male-adult");
  expect(vNode.position).toEqual({ x: 10, y: 20 });
});

test("nodes without saved position have no position field", () => {
  const els = toElements(graph);
  const pNode = els.find((e) => e.data.id === "p")!;
  expect(pNode.position).toBeUndefined();
});

test("maps edges with role label and source/target", () => {
  const els = toElements(graph);
  const edge = els.find((e) => e.data.id === "e1")!;
  expect(edge.data).toMatchObject({ source: "v", target: "p", label: "сын" });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/graphAdapter.ts`**

```ts
import type { BookGraph } from "../types.js";
import { avatarKey } from "./avatar.js";

export interface CyElement {
  data: Record<string, unknown> & { id: string };
  position?: { x: number; y: number };
}

export function toElements(graph: BookGraph): CyElement[] {
  const nodes: CyElement[] = graph.nodes.map((c) => {
    const el: CyElement = {
      data: {
        id: c.id,
        label: `${c.firstName} ${c.lastName}`.trim(),
        avatar: avatarKey(c.gender, c.age),
        gender: c.gender,
      },
    };
    if (c.posX != null && c.posY != null) el.position = { x: c.posX, y: c.posY };
    return el;
  });

  const edges: CyElement[] = graph.edges.map((e) => ({
    data: { id: e.id, source: e.sourceId, target: e.targetId, label: e.role },
  }));

  return [...nodes, ...edges];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/graphAdapter.ts web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): cytoscape element adapter"
```

### Task 2.6: Client-side validation (TDD)

**Files:**
- Create: `web/src/lib/validation.ts`
- Test: `web/src/lib/__tests__/validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { characterFormSchema } from "../validation.js";

const valid = { gender: "male", firstName: "Вася", lastName: "Петров", middleName: "", age: "30" };

test("accepts a valid form", () => {
  expect(characterFormSchema.safeParse(valid).success).toBe(true);
});

test("requires first and last name", () => {
  expect(characterFormSchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
  expect(characterFormSchema.safeParse({ ...valid, lastName: "" }).success).toBe(false);
});

test("caps names at 30 chars", () => {
  expect(characterFormSchema.safeParse({ ...valid, firstName: "x".repeat(31) }).success).toBe(false);
});

test("age must be 0..100 when provided, empty allowed", () => {
  expect(characterFormSchema.safeParse({ ...valid, age: "" }).success).toBe(true);
  expect(characterFormSchema.safeParse({ ...valid, age: "101" }).success).toBe(false);
  expect(characterFormSchema.safeParse({ ...valid, age: "-1" }).success).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace web -- validation`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/validation.ts`**

```ts
import { z } from "zod";

const name30 = z.string().trim().min(1, "Обязательное поле").max(30, "Максимум 30 символов");

export const characterFormSchema = z.object({
  gender: z.enum(["male", "female"], { message: "Выберите пол" }),
  firstName: name30,
  lastName: name30,
  middleName: z.string().trim().max(30, "Максимум 30 символов").optional().or(z.literal("")),
  age: z
    .string()
    .optional()
    .refine((v) => v == null || v === "" || /^\d{1,3}$/.test(v), "Только число")
    .refine((v) => v == null || v === "" || (Number(v) >= 0 && Number(v) <= 100), "От 0 до 100"),
});

export type CharacterForm = z.infer<typeof characterFormSchema>;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace web -- validation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/validation.ts web/src/lib/__tests__/validation.test.ts
git commit -m "feat(web): client-side form validation"
```

### Task 2.7: API client

**Files:**
- Create: `web/src/api/client.ts`

- [ ] **Step 1: Implement `web/src/api/client.ts`**

```ts
import type { Book, BookGraph, Character, RelationEntry } from "../types.js";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface CharacterInput {
  gender: "male" | "female";
  firstName: string;
  lastName: string;
  middleName?: string | null;
  age?: number | null;
  relations: RelationEntry[];
}

export const api = {
  listBooks: () => req<Book[]>("/api/books"),
  createBook: (title: string) =>
    req<Book>("/api/books", { method: "POST", body: JSON.stringify({ title }) }),
  getGraph: (bookId: string) => req<BookGraph>(`/api/books/${bookId}/graph`),
  createCharacter: (bookId: string, input: CharacterInput) =>
    req<Character>("/api/characters", {
      method: "POST",
      body: JSON.stringify({ bookId, ...input }),
    }),
  updateCharacter: (id: string, input: CharacterInput) =>
    req<Character>(`/api/characters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  savePosition: (id: string, posX: number, posY: number) =>
    req<Character>(`/api/characters/${id}/pos`, {
      method: "PATCH",
      body: JSON.stringify({ posX, posY }),
    }),
  deleteCharacter: (id: string) =>
    req<void>(`/api/characters/${id}`, { method: "DELETE" }),
};
```

- [ ] **Step 2: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(web): typed API client"
```

---

## Phase 3 — Frontend UI

### Task 3.1: MUI theme (palette C)

**Files:**
- Create: `web/src/theme.ts`

- [ ] **Step 1: Implement `web/src/theme.ts`**

```ts
import { createTheme } from "@mui/material/styles";

// Palette C · Blush & Slate (pastel, light)
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#c98a8a", contrastText: "#ffffff" },
    secondary: { main: "#8794a8" }, // slate accent
    background: { default: "#faf6f5", paper: "#ffffff" },
    text: { primary: "#54413f", secondary: "#7a5a5a" },
  },
  shape: { borderRadius: 14 },
  typography: { fontFamily: "Roboto, system-ui, sans-serif" },
});

export const GENDER_COLORS = {
  male: "#7e9bc4",
  female: "#d49db5",
} as const;

export const EDGE_COLOR = "#9aa8bd";
```

- [ ] **Step 2: Commit**

```bash
git add web/src/theme.ts
git commit -m "feat(web): MUI theme palette C"
```

### Task 3.2: Avatar component (TDD)

Renders a colored circle with a schematic male/female silhouette. Used in the character modal and as a fallback; the canvas paints its own nodes from the same color/shape rules.

**Files:**
- Create: `web/src/components/Avatar.tsx`
- Test: `web/src/components/__tests__/Avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Avatar } from "../Avatar.js";

test("uses gender color and exposes stage via test id", () => {
  render(<Avatar gender="female" age={70} size={48} />);
  const el = screen.getByTestId("avatar");
  expect(el).toHaveAttribute("data-avatar", "female-old");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace web -- Avatar`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/Avatar.tsx`**

```tsx
import type { Gender } from "../types.js";
import { avatarKey } from "../lib/avatar.js";
import { ageStage } from "../lib/ageStage.js";
import { GENDER_COLORS } from "../theme.js";

interface Props {
  gender: Gender;
  age?: number | null;
  size?: number;
}

export function Avatar({ gender, age, size = 56 }: Props) {
  const key = avatarKey(gender, age);
  const fill = GENDER_COLORS[gender];
  const light = gender === "male" ? "#eaf0f7" : "#fbeef3";
  // Slightly smaller head for child/teen for a schematic age cue.
  const stage = ageStage(age);
  const headR = stage === "child" ? 0.18 : stage === "teen" ? 0.2 : 0.22;

  return (
    <svg
      data-testid="avatar"
      data-avatar={key}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={key}
    >
      <circle cx="50" cy="50" r="48" fill={fill} />
      <circle cx="50" cy={50 - 6} r={headR * 100} fill={light} />
      <path d={`M30 ${78} a20 16 0 0 1 40 0 Z`} fill={light} />
    </svg>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace web -- Avatar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Avatar.tsx web/src/components/__tests__/Avatar.test.tsx
git commit -m "feat(web): avatar component"
```

### Task 3.3: ConfirmDialog + RelationsModal

**Files:**
- Create: `web/src/components/ConfirmDialog.tsx`, `web/src/components/RelationsModal.tsx`
- Test: `web/src/components/__tests__/RelationsModal.test.tsx`

- [ ] **Step 1: Implement `web/src/components/ConfirmDialog.tsx`**

```tsx
import { Dialog, DialogActions, DialogContent, DialogTitle, Button } from "@mui/material";

interface Props {
  open: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, title, message, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{message}</DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button color="error" onClick={onConfirm}>Удалить</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write the failing test for RelationsModal**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RelationsModal } from "../RelationsModal.js";
import type { Character } from "../../types.js";

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
  expect(onSave).toHaveBeenCalledWith([{ role: "сын", targetIds: [] }]);
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npm run test --workspace web -- RelationsModal`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `web/src/components/RelationsModal.tsx`**

```tsx
import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, MenuItem, Select, InputLabel, FormControl, OutlinedInput, Chip, Stack, Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import type { Character, RelationEntry } from "../types.js";

interface Props {
  open: boolean;
  others: Character[];
  value: RelationEntry[];
  onCancel: () => void;
  onSave: (entries: RelationEntry[]) => void;
}

export function RelationsModal({ open, others, value, onCancel, onSave }: Props) {
  const [entries, setEntries] = useState<RelationEntry[]>(value);

  const update = (i: number, patch: Partial<RelationEntry>) =>
    setEntries((e) => e.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const nameOf = (id: string) => {
    const c = others.find((o) => o.id === id);
    return c ? `${c.firstName} ${c.lastName}` : id;
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
                  value={entry.targetIds}
                  input={<OutlinedInput label="Связь" />}
                  onChange={(e) =>
                    update(i, {
                      targetIds: typeof e.target.value === "string"
                        ? e.target.value.split(",")
                        : e.target.value,
                    })
                  }
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
            </Box>
          ))}
        </Stack>
        <Button sx={{ mt: 2 }} onClick={() => setEntries((e) => [...e, { role: "", targetIds: [] }])}>
          + Добавить связь
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(entries)}>Сохранить</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test --workspace web -- RelationsModal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ConfirmDialog.tsx web/src/components/RelationsModal.tsx web/src/components/__tests__/RelationsModal.test.tsx
git commit -m "feat(web): relations modal + confirm dialog"
```

### Task 3.4: CharacterModal (TDD)

**Files:**
- Create: `web/src/components/CharacterModal.tsx`
- Test: `web/src/components/__tests__/CharacterModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CharacterModal } from "../CharacterModal.js";

test("blocks save until required fields are valid, then submits input", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal open mode="create" others={[]} onCancel={() => {}} onSubmit={onSubmit} onDelete={undefined} />,
  );
  // Submitting empty shows it did not call onSubmit.
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));
  expect(onSubmit).not.toHaveBeenCalled();

  await userEvent.click(screen.getByLabelText(/пол/i));
  await userEvent.click(screen.getByRole("option", { name: /мужчина/i }));
  await userEvent.type(screen.getByLabelText(/имя/i), "Вася");
  await userEvent.type(screen.getByLabelText(/фамилия/i), "Петров");
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ gender: "male", firstName: "Вася", lastName: "Петров", relations: [] }),
  );
});

test("edit mode shows a delete button", () => {
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "female", firstName: "Аня", lastName: "С", relations: [] }}
      onCancel={() => {}} onSubmit={() => {}} onDelete={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /удалить/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace web -- CharacterModal`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/components/CharacterModal.tsx`**

```tsx
import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  MenuItem, Stack, Box,
} from "@mui/material";
import type { Character, Gender, RelationEntry } from "../types.js";
import { characterFormSchema } from "../lib/validation.js";
import { RelationsModal } from "./RelationsModal.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import type { CharacterInput } from "../api/client.js";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  others: Character[];
  initial?: CharacterInput;
  onCancel: () => void;
  onSubmit: (input: CharacterInput) => void;
  onDelete?: () => void;
}

const empty: CharacterInput = {
  gender: "male", firstName: "", lastName: "", middleName: "", age: null, relations: [],
};

export function CharacterModal({ open, mode, others, initial, onCancel, onSubmit, onDelete }: Props) {
  const [gender, setGender] = useState<Gender | "">(initial?.gender ?? "");
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [middleName, setMiddleName] = useState(initial?.middleName ?? "");
  const [age, setAge] = useState(initial?.age != null ? String(initial.age) : "");
  const [relations, setRelations] = useState<RelationEntry[]>(initial?.relations ?? empty.relations);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const submit = () => {
    const result = characterFormSchema.safeParse({ gender, firstName, lastName, middleName, age });
    if (!result.success) {
      const flat: Record<string, string> = {};
      for (const issue of result.error.issues) flat[String(issue.path[0])] = issue.message;
      setErrors(flat);
      return;
    }
    setErrors({});
    onSubmit({
      gender: gender as Gender,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      middleName: middleName.trim() || null,
      age: age === "" ? null : Number(age),
      relations,
    });
  };

  return (
    <>
      <Dialog open={open} onClose={onCancel} fullScreen={false} fullWidth maxWidth="sm"
        PaperProps={{ sx: { maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 32px)" } }}>
        <DialogTitle>{mode === "create" ? "Новый персонаж" : "Персонаж"}</DialogTitle>
        <DialogContent dividers sx={{ overflowY: "auto" }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Пол" value={gender} error={!!errors.gender} helperText={errors.gender ?? "Обязательно"}
              onChange={(e) => setGender(e.target.value as Gender)}>
              <MenuItem value="male">Мужчина</MenuItem>
              <MenuItem value="female">Женщина</MenuItem>
            </TextField>
            <TextField label="Имя" value={firstName} inputProps={{ maxLength: 30 }} error={!!errors.firstName}
              helperText={errors.firstName ?? "До 30 символов"} onChange={(e) => setFirstName(e.target.value)} />
            <TextField label="Фамилия" value={lastName} inputProps={{ maxLength: 30 }} error={!!errors.lastName}
              helperText={errors.lastName ?? "До 30 символов"} onChange={(e) => setLastName(e.target.value)} />
            <TextField label="Отчество" value={middleName} inputProps={{ maxLength: 30 }} error={!!errors.middleName}
              helperText={errors.middleName ?? "Необязательно, до 30 символов"} onChange={(e) => setMiddleName(e.target.value)} />
            <TextField label="Возраст" value={age} error={!!errors.age}
              helperText={errors.age ?? "Необязательно, 0–100"} onChange={(e) => setAge(e.target.value)} />
            <Box>
              <Button variant="outlined" onClick={() => setRelationsOpen(true)}>
                Связи ({relations.length})
              </Button>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ position: "sticky", bottom: 0, bgcolor: "background.paper" }}>
          {mode === "edit" && onDelete && (
            <Button color="error" onClick={() => setConfirmOpen(true)} sx={{ mr: "auto" }}>Удалить</Button>
          )}
          <Button onClick={onCancel}>Отмена</Button>
          <Button variant="contained" onClick={submit}>{mode === "create" ? "Добавить" : "Сохранить"}</Button>
        </DialogActions>
      </Dialog>

      <RelationsModal open={relationsOpen} others={others} value={relations}
        onCancel={() => setRelationsOpen(false)}
        onSave={(e) => { setRelations(e); setRelationsOpen(false); }} />

      <ConfirmDialog open={confirmOpen} title="Удалить персонажа?"
        message="Это действие необратимо. Связи персонажа также будут удалены."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); onDelete?.(); }} />
    </>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace web -- CharacterModal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CharacterModal.tsx web/src/components/__tests__/CharacterModal.test.tsx
git commit -m "feat(web): character modal with validation"
```

### Task 3.5: TopBar + AddFab

**Files:**
- Create: `web/src/components/TopBar.tsx`, `web/src/components/AddFab.tsx`

- [ ] **Step 1: Implement `web/src/components/TopBar.tsx`**

```tsx
import { AppBar, Toolbar, Typography, IconButton, Box } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

interface Props {
  onBack?: () => void;
}

export function TopBar({ onBack }: Props) {
  return (
    <AppBar position="sticky" color="primary" sx={{ pt: "env(safe-area-inset-top)" }}>
      <Toolbar>
        <Box sx={{ width: 48 }}>
          {onBack && (
            <IconButton edge="start" color="inherit" aria-label="назад" onClick={onBack}>
              <ArrowBackIcon />
            </IconButton>
          )}
        </Box>
        <Typography variant="h6" sx={{ flex: 1, textAlign: "center" }}>
          Roles Mind Map
        </Typography>
        <Box sx={{ width: 48 }} />
      </Toolbar>
    </AppBar>
  );
}
```

- [ ] **Step 2: Implement `web/src/components/AddFab.tsx`**

```tsx
import { Fab } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

export function AddFab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Fab color="primary" aria-label={label} onClick={onClick}
      sx={{
        position: "fixed",
        right: "calc(16px + env(safe-area-inset-right))",
        bottom: "calc(16px + env(safe-area-inset-bottom))",
      }}>
      <AddIcon />
    </Fab>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/TopBar.tsx web/src/components/AddFab.tsx
git commit -m "feat(web): top bar + floating add button"
```

### Task 3.6: BooksScreen + App router (TDD)

**Files:**
- Create: `web/src/screens/BooksScreen.tsx`
- Replace: `web/src/App.tsx`
- Test: `web/src/screens/__tests__/BooksScreen.test.tsx`

- [ ] **Step 1: Write the failing test** (mocks the api module)

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi, beforeEach } from "vitest";
import { api } from "../../api/client.js";
import { BooksScreen } from "../BooksScreen.js";

vi.mock("../../api/client.js", () => ({
  api: { listBooks: vi.fn(), createBook: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

test("shows centered add button when empty", async () => {
  (api.listBooks as any).mockResolvedValue([]);
  render(<MemoryRouter><BooksScreen /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: /добавить книгу/i })).toBeInTheDocument();
});

test("adds a book through the modal", async () => {
  (api.listBooks as any).mockResolvedValue([]);
  (api.createBook as any).mockResolvedValue({ id: "1", title: "Война и мир", sortOrder: 0 });
  render(<MemoryRouter><BooksScreen /></MemoryRouter>);

  await userEvent.click(await screen.findByRole("button", { name: /добавить книгу/i }));
  await userEvent.type(screen.getByLabelText(/название/i), "Война и мир");
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));

  await waitFor(() => expect(api.createBook).toHaveBeenCalledWith("Война и мир"));
  expect(await screen.findByText(/Война и мир/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test --workspace web -- BooksScreen`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/screens/BooksScreen.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  List, ListItemButton, ListItemText, Typography,
} from "@mui/material";
import { api } from "../api/client.js";
import type { Book } from "../types.js";
import { TopBar } from "../components/TopBar.js";
import { AddFab } from "../components/AddFab.js";

export function BooksScreen() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    api.listBooks().then((b) => { setBooks(b); setLoaded(true); });
  }, []);

  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const book = await api.createBook(trimmed);
    setBooks((b) => [...b, book]);
    setTitle("");
    setOpen(false);
  };

  const empty = loaded && books.length === 0;

  return (
    <>
      {!empty && <TopBar />}
      {empty ? (
        <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <Typography variant="h4" color="primary">Roles Mind Map</Typography>
          <Button variant="contained" size="large" onClick={() => setOpen(true)}>Добавить книгу</Button>
        </Box>
      ) : (
        <>
          <List sx={{ pb: 10 }}>
            {books.map((b, i) => (
              <ListItemButton key={b.id} onClick={() => navigate(`/books/${b.id}`)}>
                <ListItemText primary={`${i + 1}. ${b.title}`} />
              </ListItemButton>
            ))}
          </List>
          <AddFab label="Добавить книгу" onClick={() => setOpen(true)} />
        </>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Новая книга</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth label="Название" value={title} sx={{ mt: 1 }}
            inputProps={{ maxLength: 60 }} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={add}>Добавить</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Replace `web/src/App.tsx`**

```tsx
import { ThemeProvider, CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { theme } from "./theme.js";
import { BooksScreen } from "./screens/BooksScreen.js";
import { BookScreen } from "./screens/BookScreen.js";

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BooksScreen />} />
          <Route path="/books/:bookId" element={<BookScreen />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
```

Note: `BookScreen` is created in Task 3.8. App will not compile until then — run `BooksScreen` tests in isolation; full `npm run build --workspace web` happens after Task 3.8.

- [ ] **Step 5: Run to verify pass**

Run: `npm run test --workspace web -- BooksScreen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/screens/BooksScreen.tsx web/src/App.tsx web/src/screens/__tests__/BooksScreen.test.tsx
git commit -m "feat(web): books screen + router"
```

### Task 3.7: MindMap canvas component

Wraps Cytoscape + cola. Not unit-tested (canvas DOM/physics); covered by the e2e happy path. Keep it small and prop-driven.

**Files:**
- Create: `web/src/canvas/MindMap.tsx`

- [ ] **Step 1: Implement `web/src/canvas/MindMap.tsx`**

```tsx
import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import cola from "cytoscape-cola";
import type { BookGraph } from "../types.js";
import { toElements } from "../lib/graphAdapter.js";
import { GENDER_COLORS, EDGE_COLOR } from "../theme.js";

cytoscape.use(cola);

interface Props {
  graph: BookGraph;
  onNodeTap: (id: string) => void;
  onNodeMoved: (id: string, x: number, y: number) => void;
}

export function MindMap({ graph, onNodeTap, onNodeMoved }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements: toElements(graph),
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele: any) => GENDER_COLORS[ele.data("gender") as "male" | "female"],
            label: "data(label)",
            "text-valign": "bottom",
            "text-margin-y": 6,
            "font-size": 11,
            color: "#54413f",
            width: 46,
            height: 46,
          },
        },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": EDGE_COLOR,
            "target-arrow-color": EDGE_COLOR,
            width: 2,
            "font-size": 9,
            color: "#7a5a5a",
            "text-background-color": "#ffffff",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
          },
        },
      ],
      layout: { name: "cola", animate: true, infinite: true, fit: false } as any,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => onNodeTap(evt.target.id()));
    cy.on("dragfree", "node", (evt) => {
      const p = evt.target.position();
      onNodeMoved(evt.target.id(), p.x, p.y);
    });

    return () => { cy.destroy(); cyRef.current = null; };
    // Re-init when the set of node/edge ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes.map((n) => n.id).join(","), graph.edges.map((e) => e.id).join(",")]);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b web/tsconfig.json` (or `npm run build --workspace web` after Task 3.8)
Expected: no type errors in this file.

- [ ] **Step 3: Commit**

```bash
git add web/src/canvas/MindMap.tsx
git commit -m "feat(web): cytoscape mind-map canvas"
```

### Task 3.8: BookScreen (wires modal + canvas + api)

**Files:**
- Create: `web/src/screens/BookScreen.tsx`

- [ ] **Step 1: Implement `web/src/screens/BookScreen.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { api, type CharacterInput } from "../api/client.js";
import type { BookGraph, Character } from "../types.js";
import { TopBar } from "../components/TopBar.js";
import { AddFab } from "../components/AddFab.js";
import { CharacterModal } from "../components/CharacterModal.js";
import { MindMap } from "../canvas/MindMap.js";
import { groupEdges } from "../lib/relations.js";

export function BookScreen() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<BookGraph>({ nodes: [], edges: [] });
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; character?: Character } | null>(null);

  const refresh = () => api.getGraph(bookId!).then((g) => { setGraph(g); setLoaded(true); });
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [bookId]);

  const others = useMemo(
    () => graph.nodes.filter((n) => n.id !== modal?.character?.id),
    [graph.nodes, modal],
  );

  const initial: CharacterInput | undefined = modal?.character && {
    gender: modal.character.gender,
    firstName: modal.character.firstName,
    lastName: modal.character.lastName,
    middleName: modal.character.middleName ?? "",
    age: modal.character.age ?? null,
    relations: groupEdges(modal.character.id, graph.edges),
  };

  const submit = async (input: CharacterInput) => {
    if (modal?.mode === "edit" && modal.character) {
      await api.updateCharacter(modal.character.id, input);
    } else {
      await api.createCharacter(bookId!, input);
    }
    setModal(null);
    await refresh();
  };

  const remove = async () => {
    if (modal?.character) await api.deleteCharacter(modal.character.id);
    setModal(null);
    await refresh();
  };

  const empty = loaded && graph.nodes.length === 0;

  return (
    <Box sx={{ minHeight: "100dvh", position: "relative" }}>
      <TopBar onBack={() => navigate("/")} />
      {empty ? (
        <Box sx={{ minHeight: "70dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <Typography variant="h5">Персонажей пока нет</Typography>
          <Button variant="contained" size="large" onClick={() => setModal({ mode: "create" })}>
            Добавить персонажа
          </Button>
        </Box>
      ) : (
        <Box sx={{ position: "absolute", top: 56, left: 0, right: 0, bottom: 0 }}>
          <MindMap
            graph={graph}
            onNodeTap={(id) => {
              const character = graph.nodes.find((n) => n.id === id);
              if (character) setModal({ mode: "edit", character });
            }}
            onNodeMoved={(id, x, y) => { void api.savePosition(id, x, y); }}
          />
        </Box>
      )}

      {!empty && <AddFab label="Добавить персонажа" onClick={() => setModal({ mode: "create" })} />}

      {modal && (
        <CharacterModal
          open
          mode={modal.mode}
          others={others}
          initial={initial}
          onCancel={() => setModal(null)}
          onSubmit={submit}
          onDelete={modal.mode === "edit" ? remove : undefined}
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Full type-check + build + tests**

Run: `npm run build --workspace web && npm run test --workspace web`
Expected: build succeeds; all web tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/screens/BookScreen.tsx
git commit -m "feat(web): book screen wiring canvas + character modal"
```

---

## Phase 4 — Docker packaging

### Task 4.1: Dockerfile + compose

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`

- [ ] **Step 1: `.dockerignore`**

```
node_modules
**/node_modules
**/dist
*.db
.git
.superpowers
playwright-report
test-results
```

- [ ] **Step 2: `Dockerfile`** (multi-stage)

```dockerfile
# --- build web ---
FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci --workspace web --include-workspace-root
COPY web ./web
RUN npm run build --workspace web

# --- build server ---
FROM node:20-slim AS server
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace server --include-workspace-root
COPY server ./server
RUN npm run prisma:generate --workspace server && npm run build --workspace server

# --- runtime ---
FROM node:20-slim AS runtime
WORKDIR /app/server
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/app.db"
ENV PORT=3000
COPY --from=server /app/node_modules /app/node_modules
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/prisma ./prisma
COPY --from=server /app/server/package.json ./package.json
COPY --from=web /app/web/dist ./public
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 3: `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - rmm-data:/data
volumes:
  rmm-data:
```

- [ ] **Step 4: Build + run + smoke test**

Run:
```bash
docker compose build
docker compose up -d
sleep 3
curl -s localhost:3000/api/books
```
Expected: `[]`. Open `http://localhost:3000` in a browser → empty "Добавить книгу" screen. Create a book, reload → it persists. `docker compose down` (volume keeps data).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "feat: single-image docker packaging"
```

---

## Phase 5 — E2E happy path

### Task 5.1: Playwright happy path

**Files:**
- Create: `playwright.config.ts`, `e2e/happy-path.spec.ts`
- Modify: root `package.json` (add `test:e2e` script + devDeps)

- [ ] **Step 1: Add Playwright to root `package.json`**

Add to `devDependencies`: `"@playwright/test": "^1.46.0"`. Add to `scripts`: `"test:e2e": "playwright test"`.
Run: `npm install && npx playwright install chromium`

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "docker compose up --build",
    url: "http://localhost:3000/api/books",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
```

- [ ] **Step 3: `e2e/happy-path.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("create book, add character, see node on canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /добавить книгу/i }).click();
  await page.getByLabel(/название/i).fill("Война и мир");
  await page.getByRole("button", { name: /^добавить$/i }).click();

  await page.getByText(/Война и мир/).click();

  await page.getByRole("button", { name: /добавить персонажа/i }).click();
  await page.getByLabel(/пол/i).click();
  await page.getByRole("option", { name: /мужчина/i }).click();
  await page.getByLabel(/имя/i).fill("Вася");
  await page.getByLabel(/фамилия/i).fill("Петров");
  await page.getByRole("button", { name: /^добавить$/i }).click();

  // Canvas appears (a <canvas> element rendered by cytoscape) and FAB is present.
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByLabel(/добавить персонажа/i)).toBeVisible();
});
```

- [ ] **Step 4: Run**

Run: `npm run test:e2e`
Expected: PASS (1 test). Tear down with `docker compose down` if needed.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/happy-path.spec.ts package.json package-lock.json
git commit -m "test(e2e): happy-path flow"
```

---

## Phase 6 — Docs

### Task 6.1: README + CLAUDE.md update

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Expand `README.md`** with: project description, `docker compose up --build` quickstart, `http://localhost:3000`, dev mode (`npm run dev:server` + `npm run dev:web`), test commands (`npm test`, `npm run test:e2e`).

```markdown
# Roles-Mind-Map

A simple mind map for book characters.

## Run (Docker)

```bash
docker compose up --build
# open http://localhost:3000
```
Data persists in the `rmm-data` volume.

## Develop

```bash
npm install
npm run dev:server   # API on :3000
npm run dev:web      # Vite on :5173 (proxies /api to :3000)
```

## Test

```bash
npm test             # server + web unit/integration
npm run test:e2e     # Playwright happy path (needs docker)
```

## Stack

React + MUI + Cytoscape.js (PWA) · Fastify + Prisma + SQLite · single Docker image.
See `docs/superpowers/specs/2026-06-16-roles-mind-map-design.md`.
```

- [ ] **Step 2: Update `CLAUDE.md`** — replace the "Status: scaffold" section with the real build/run/test commands and the architecture summary (monorepo `server/` + `web/`, single Docker image, normalized SQLite schema, directed relationships).

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: project README + CLAUDE.md update"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Flow 1 (Task 3.6), Flow 2 incl. character/relations modals (Tasks 3.3–3.4, 3.8), Flow 3 canvas (Tasks 2.5, 3.7), relationship semantics "Я — [роль]" (Tasks 1.5, 2.4), normalized schema (1.1), REST API (1.7), PWA installable (2.1 vite-plugin-pwa), palette C (3.1), avatars by gender×age (2.3, 3.2), Docker single image (4.1), multi-user-ready `user_id` (1.1–1.2, 1.7), testing across layers (throughout + 5.1). All covered.
- **Out of scope** (auth UI, offline-first, Postgres) intentionally omitted per spec.
- **Type consistency:** `CharacterInput`, `RelationEntry`, `BookGraph`, `toElements`, `groupEdges/expandEntries`, `reconcileRelationships`, `avatarKey/ageStage` names match across producing and consuming tasks.
- **Known compile-order caveats** are called out inline (helpers.ts ↔ app.ts in 1.5/1.7; App.tsx ↔ BookScreen in 3.6/3.8) with explicit unblocking instructions.
