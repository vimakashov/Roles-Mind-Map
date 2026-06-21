# Одна ненаправленная связь на пару персонажей — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Между двумя персонажами может существовать только одна **ненаправленная** связь; убрать возможность создать дубль пары (в любом направлении).

**Architecture:** SQLite/Prisma хранит ровно одну строку `Relationship` на неупорядоченную пару в каноническом порядке (`sourceId < targetId`), уникальность гарантирует `@@unique([sourceId, targetId])`. Wire-формат связей становится плоским списком соединений `{ otherId, role, color }`. `reconcileRelationships` смотрит обе стороны (инцидентные рёбра) и канонизирует. UI рисует линию без стрелки и в «Добавить связь» скрывает уже связанных. Старая БД нормализуется идемпотентным шагом перед `prisma db push`.

**Tech Stack:** Fastify 4, Prisma 5, SQLite, Zod, React 18 + TypeScript + MUI + Cytoscape.js, Vitest, Playwright.

## Global Constraints

- Связь **ненаправленная**, **ровно одна строка на неупорядоченную пару**; на холсте — линия без стрелки.
- Хранение **каноническое**: `sourceId` = лексикографически меньший id, `targetId` = больший (`sourceId < targetId`).
- БД-ограничение: `@@unique([sourceId, targetId])`.
- `role` — симметричная метка, `String`, `trim`, `max 30`, допускает пустую строку `""` (default `""`); хранится строкой, **никогда `NULL`**.
- `color` — nullable hex `#rrggbb` (regex `/^#[0-9a-fA-F]{6}$/`); `null` = дефолтный `EDGE_COLOR`, в БД не пишется.
- Wire-формат связей — плоский: `Array<{ otherId: string; role: string; color: string | null }>`; форма проверяется в **двух** местах (`relationships.test.ts` и `api.test.ts`) — менять синхронно.
- Self-target (`otherId === characterId`) игнорируется.
- Сервер без обработки изображений (правило не меняем). API-клиент шлёт `Content-Type: application/json` только при наличии тела — не трогаем.
- Цветовой пикер в `RelationsModal` — MUI `Popper` (не `Popover`).
- Имя/роль cap = 30 (`name30`), заголовок книги cap = 60 (`title60`).
- Серверная схема на старте: миграций нет, `server/src/server.ts` делает `prisma db push`. **Перед** ним выполняется `normalizeRelationships()`.
- После крупных правок web запускать `npx tsc --noEmit -p web/tsconfig.json` (Vitest через esbuild не ловит дубли/типы, которые ловит `tsc`/Docker-сборка).

---

## File Structure

**Сервер**
- `server/prisma/schema.prisma` — модель `Relationship`: unique `[sourceId, targetId]`.
- `server/src/services/normalize.ts` *(создать)* — `normalizeRelationships()`: схлопывание дублей пары + канонизация (raw SQL, guard «таблица существует»).
- `server/src/server.ts` — вызвать `normalizeRelationships()` перед `prisma db push`.
- `server/src/schemas.ts` — `relationConnectionSchema` (плоский), тип `RelationConnection`.
- `server/src/services/relationships.ts` — `reconcileRelationships` «по инцидентным рёбрам» + канонизация.
- `server/test/normalize.test.ts` *(создать)* — схлопывание/канонизация.
- `server/test/relationships.test.ts` — переписать под плоский reconcile.
- `server/test/api.test.ts` — переписать payload'ы + новые e2e-кейсы.

**Веб**
- `web/src/canvas/MindMap.tsx` — `target-arrow-shape: "none"`.
- `web/src/canvas/__tests__/MindMap.test.tsx` — тест «у ребра нет стрелки».
- `web/src/types.ts` — `RelationConnection` вместо `RelationEntry`/`RelationTarget`.
- `web/src/lib/relations.ts` — `incidentConnections` вместо `groupEdges`/`expandEntries`.
- `web/src/lib/__tests__/relations.test.ts` — тесты `incidentConnections`.
- `web/src/api/client.ts` — `CharacterInput.relations: RelationConnection[]`.
- `web/src/components/RelationsModal.tsx` — переписать на строки (персонаж + роль + цвет + удалить; «+ Добавить связь»).
- `web/src/components/__tests__/RelationsModal.test.tsx` — переписать.
- `web/src/components/CharacterModal.tsx` — тип состояния `relations`.
- `web/src/screens/BookScreen.tsx` — `incidentConnections`.

**Документация**
- `CLAUDE.md` — схема, gotcha'и, заметки.

---

### Task 1: БД-схема (unique на пару) + нормализация старых данных

**Files:**
- Modify: `server/prisma/schema.prisma:57`
- Create: `server/src/services/normalize.ts`
- Modify: `server/src/server.ts:1-14`
- Test: `server/test/normalize.test.ts` *(создать)*

**Interfaces:**
- Produces: `normalizeRelationships(client?: Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">): Promise<void>` — идемпотентно; на отсутствие таблицы `Relationship` — no-op.

Контекст: старый reconcile и старый wire-формат остаются нетронутыми в этой задаче — релаксация unique с `[sourceId, targetId, role]` до `[sourceId, targetId]` существующие серверные тесты не ломает (все они создают рёбра от одного `sourceId` к разным `targetId`). Поэтому задача завершается зелёной полностью.

- [ ] **Step 1: Поменять unique-индекс в схеме**

В `server/prisma/schema.prisma` заменить строку 57:

```prisma
  @@unique([sourceId, targetId, role])
```

на:

```prisma
  @@unique([sourceId, targetId])
```

- [ ] **Step 2: Перегенерировать Prisma client под новую схему**

Run: `npx prisma generate --schema server/prisma/schema.prisma`
Expected: `Generated Prisma Client ...` без ошибок.

- [ ] **Step 3: Написать падающий тест нормализации**

Создать `server/test/normalize.test.ts`:

```ts
import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { normalizeRelationships } from "../src/services/normalize.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seed() {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "Book" } });
  const mk = (firstName: string) =>
    prisma.character.create({ data: { bookId: book.id, gender: "male", firstName, lastName: "X" } });
  const a = await mk("A");
  const b = await mk("B");
  return { book, a, b };
}

test("collapses a duplicate unordered pair, keeping the earliest, and canonicalises order", async () => {
  const { book, a, b } = await seed();
  const [lo, hi] = [a.id, b.id].sort();
  // earliest row, stored non-canonically (hi -> lo) so we also exercise canonicalisation
  await prisma.relationship.create({
    data: { bookId: book.id, sourceId: hi, targetId: lo, role: "early", createdAt: new Date("2020-01-01T00:00:00Z") },
  });
  // later duplicate in the reverse direction (lo -> hi) -> must be removed
  await prisma.relationship.create({
    data: { bookId: book.id, sourceId: lo, targetId: hi, role: "late", createdAt: new Date("2021-01-01T00:00:00Z") },
  });

  await normalizeRelationships(prisma);

  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("early");
  expect(rows[0].sourceId).toBe(lo);
  expect(rows[0].targetId).toBe(hi);
});

test("is idempotent on already-canonical, unique data", async () => {
  const { book, a, b } = await seed();
  const [lo, hi] = [a.id, b.id].sort();
  await prisma.relationship.create({ data: { bookId: book.id, sourceId: lo, targetId: hi, role: "друзья" } });

  await normalizeRelationships(prisma);
  await normalizeRelationships(prisma);

  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sourceId: lo, targetId: hi, role: "друзья" });
});
```

- [ ] **Step 4: Запустить тест — убедиться, что падает**

Run: `npm run test --workspace server -- normalize`
Expected: FAIL — `Cannot find module '../src/services/normalize.js'`.

- [ ] **Step 5: Реализовать `normalizeRelationships`**

Создать `server/src/services/normalize.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";

type RawClient = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

/**
 * Idempotent pre-`db push` migration for the undirected-single-relationship change.
 * Guarded by "the Relationship table exists" so a fresh DB (no table yet) is a no-op.
 * 1) For every unordered pair keep the earliest row by createdAt, delete the rest.
 * 2) Canonicalise survivors so sourceId < targetId.
 * SQLite evaluates all SET RHS against the pre-update row, so the swap is safe.
 */
export async function normalizeRelationships(client: RawClient = prisma): Promise<void> {
  const tables = await client.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='Relationship'`,
  );
  if (tables.length === 0) return;

  await client.$executeRawUnsafe(`
    DELETE FROM "Relationship"
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY MIN("sourceId", "targetId"), MAX("sourceId", "targetId")
          ORDER BY "createdAt" ASC, id ASC
        ) AS rn
        FROM "Relationship"
      ) WHERE rn = 1
    )
  `);

  await client.$executeRawUnsafe(`
    UPDATE "Relationship"
    SET "sourceId" = "targetId", "targetId" = "sourceId"
    WHERE "sourceId" > "targetId"
  `);
}
```

- [ ] **Step 6: Запустить тест — убедиться, что проходит**

Run: `npm run test --workspace server -- normalize`
Expected: PASS (2 теста).

- [ ] **Step 7: Подключить нормализацию в server.ts перед `db push`**

В `server/src/server.ts` добавить импорт после строки 6 (`import { ensureDefaultUser } ...`):

```ts
import { normalizeRelationships } from "./services/normalize.js";
```

И в `main()` заменить блок строк 12-14:

```ts
  execSync("prisma db push --skip-generate", { stdio: "inherit" });
  await ensureDefaultUser();
```

на:

```ts
  // Collapse legacy duplicate pairs + canonicalise BEFORE the schema push, so the
  // new @@unique([sourceId, targetId]) index can be created on existing volumes.
  await normalizeRelationships();
  execSync("prisma db push --skip-generate", { stdio: "inherit" });
  await ensureDefaultUser();
```

- [ ] **Step 8: Прогнать весь серверный пакет (схема релаксирована — должно остаться зелёным)**

Run: `npm run test --workspace server`
Expected: PASS (все тесты, включая старые `relationships`/`api`).

- [ ] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/src/services/normalize.ts server/src/server.ts server/test/normalize.test.ts
git commit -m "feat(server): unique relationship per pair + legacy data normalization

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Серверный wire-формат + ненаправленный reconcile

**Files:**
- Modify: `server/src/schemas.ts:11-19,28,38`
- Modify: `server/src/services/relationships.ts` (весь файл)
- Test: `server/test/relationships.test.ts` (весь файл)
- Test: `server/test/api.test.ts` (правка payload'ов + новые кейсы)

**Interfaces:**
- Consumes: `@@unique([sourceId, targetId])` из Task 1.
- Produces:
  - `relationConnectionSchema` — Zod `{ otherId: string; role: string (default ""); color: string|null }`.
  - `type RelationConnection` — `z.infer<typeof relationConnectionSchema>`.
  - `reconcileRelationships(tx, bookId, characterId, connections: RelationConnection[]): Promise<void>` — смотрит обе стороны, канонизирует, апдейтит role+color.
  - `characterCreateSchema.relations: RelationConnection[]` (default `[]`).

- [ ] **Step 1: Заменить серверный тест reconcile на плоский формат (падающий)**

Заменить весь `server/test/relationships.test.ts`:

```ts
import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileRelationships } from "../src/services/relationships.js";
import { relationConnectionSchema } from "../src/schemas.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seed() {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "Book" } });
  const mk = (firstName: string) =>
    prisma.character.create({ data: { bookId: book.id, gender: "male", firstName, lastName: "X" } });
  const vasya = await mk("Vasya");
  const petya = await mk("Petya");
  const zhanna = await mk("Zhanna");
  return { book, vasya, petya, zhanna };
}

test("creates a connection stored canonically (sourceId < targetId)", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].sourceId < rows[0].targetId).toBe(true);
  expect(rows[0].role).toBe("друзья");
});

test("a connection created from one side is incident (visible) from the other side", async () => {
  const { book, vasya, petya } = await seed();
  // create from vasya
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  // reconciling petya with the same single connection must NOT duplicate it
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, [{ otherId: vasya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
});

test("does not create a duplicate row for the reverse direction", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  // petya re-asserts the same edge -> still one row
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, [{ otherId: vasya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
});

test("editing the role from the other side updates the same row", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, [{ otherId: vasya.id, role: "враги", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("враги");
});

test("adds and removes incident rows to match the desired set", async () => {
  const { book, vasya, petya, zhanna } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "", color: null }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: zhanna.id, role: "", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  const otherOf = (r: { sourceId: string; targetId: string }) =>
    r.sourceId === vasya.id ? r.targetId : r.sourceId;
  expect(otherOf(rows[0])).toBe(zhanna.id);
});

test("a connection removed from the other side is deleted", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, []),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(0);
});

test("drops self-connections", async () => {
  const { book, vasya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: vasya.id, role: "self", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(0);
});

test("persists colour on create", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: "#ff0000" }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows[0].color).toBe("#ff0000");
});

test("stores null colour as default (no colour written)", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows[0].color).toBeNull();
});

test("updates colour when only the colour changes", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: "#111111" }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: "#222222" }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].color).toBe("#222222");
});

test("reconcile stores an empty role as a blank-labelled edge", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("");
});

test("relationConnectionSchema accepts an empty role (defaults to '')", () => {
  const result = relationConnectionSchema.safeParse({ otherId: "x", color: null });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.role).toBe("");
});

test("relationConnectionSchema rejects an invalid hex colour", () => {
  expect(relationConnectionSchema.safeParse({ otherId: "x", role: "друг", color: "red" }).success).toBe(false);
});

test("relationConnectionSchema accepts a null colour", () => {
  expect(relationConnectionSchema.safeParse({ otherId: "x", role: "друг", color: null }).success).toBe(true);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test --workspace server -- relationships`
Expected: FAIL — `relationConnectionSchema` не экспортируется / reconcile не принимает плоский формат.

- [ ] **Step 3: Обновить схему валидации**

В `server/src/schemas.ts` заменить блок строк 11-19:

```ts
export const relationEntrySchema = z.object({
  role: z.string().trim().max(30).optional().default(""),
  targets: z.array(
    z.object({
      id: z.string().min(1),
      color: hexColor.nullable(),
    }),
  ),
});
```

на:

```ts
export const relationConnectionSchema = z.object({
  otherId: z.string().min(1),
  role: z.string().trim().max(30).optional().default(""),
  color: hexColor.nullable(),
});
```

В том же файле строку 28 (`relations: z.array(relationEntrySchema).default([]),`) заменить на:

```ts
  relations: z.array(relationConnectionSchema).default([]),
```

И строку 38 (`export type RelationEntry = z.infer<typeof relationEntrySchema>;`) заменить на:

```ts
export type RelationConnection = z.infer<typeof relationConnectionSchema>;
```

- [ ] **Step 4: Переписать reconcile «по инцидентным рёбрам»**

Заменить весь `server/src/services/relationships.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { RelationConnection } from "../schemas.js";

type Tx = Prisma.TransactionClient;

/**
 * Makes the undirected relationships incident to `characterId` exactly match `connections`.
 * The graph is undirected and stores ONE canonical row per unordered pair
 * (sourceId < targetId). We look at both endpoints so a connection created
 * "from the other side" is seen and never duplicated. Self-connections are ignored.
 */
export async function reconcileRelationships(
  tx: Tx,
  bookId: string,
  characterId: string,
  connections: RelationConnection[],
): Promise<void> {
  const desired = new Map<string, { role: string; color: string | null }>();
  for (const c of connections) {
    if (c.otherId === characterId) continue;
    desired.set(c.otherId, { role: c.role.trim(), color: c.color });
  }

  const existing = await tx.relationship.findMany({
    where: { OR: [{ sourceId: characterId }, { targetId: characterId }] },
  });
  const otherOf = (r: { sourceId: string; targetId: string }) =>
    r.sourceId === characterId ? r.targetId : r.sourceId;
  const existingByOther = new Map(existing.map((r) => [otherOf(r), r]));

  const toDelete = existing.filter((r) => !desired.has(otherOf(r)));
  if (toDelete.length > 0) {
    await tx.relationship.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
  }

  const toCreate = [...desired.entries()]
    .filter(([otherId]) => !existingByOther.has(otherId))
    .map(([otherId, v]) => {
      const [sourceId, targetId] =
        characterId < otherId ? [characterId, otherId] : [otherId, characterId];
      return { bookId, sourceId, targetId, role: v.role, color: v.color };
    });
  if (toCreate.length > 0) {
    await tx.relationship.createMany({ data: toCreate });
  }

  for (const [otherId, v] of desired) {
    const ex = existingByOther.get(otherId);
    if (ex && (ex.role !== v.role || ex.color !== v.color)) {
      await tx.relationship.update({ where: { id: ex.id }, data: { role: v.role, color: v.color } });
    }
  }
}
```

- [ ] **Step 5: Запустить фокусный тест — убедиться, что проходит**

Run: `npm run test --workspace server -- relationships`
Expected: PASS.

- [ ] **Step 6: Обновить payload'ы в api.test.ts под плоский формат**

В `server/test/api.test.ts` заменить каждое старое включение связей на плоское:

1. Строка ~39 — заменить
```ts
      relations: [{ role: "сын", targets: [{ id: petya.id, color: null }] }],
```
на
```ts
      relations: [{ otherId: petya.id, role: "сын", color: null }],
```

2. Строка ~71 — заменить `relations: [{ role: "друг", targets: [{ id: a.id, color: null }] }]` на `relations: [{ otherId: a.id, role: "друг", color: null }]`.

3. Строка ~76 — заменить `relations: [{ role: "друг", targets: [{ id: b.id, color: null }] }]` на `relations: [{ otherId: b.id, role: "друг", color: null }]`.

4. Строка ~87 — заменить `relations: [{ role: "жена", targets: [{ id: a.id, color: null }] }]` на `relations: [{ otherId: a.id, role: "жена", color: null }]`.

Тест «updates character relations via reconciliation» проверяет `graph.edges[0].targetId).toBe(b.id)` — теперь хранение каноническое, направление не гарантируется. Заменить строки ~79-81:
```ts
  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0].targetId).toBe(b.id);
```
на:
```ts
  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
  const e = graph.edges[0];
  expect([e.sourceId, e.targetId]).toContain(b.id);
  expect([e.sourceId, e.targetId]).toContain(v.id);
```

- [ ] **Step 7: Добавить e2e-кейсы ненаправленности в api.test.ts**

Вставить после теста «updates character relations via reconciliation» (после его закрывающей `});`, ~строка 82):

```ts
test("a relation created from B is visible and editable from A", async () => {
  const book = await createBook();
  const a = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "A", lastName: "X", relations: [] } })).json();
  const b = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "B", lastName: "X", relations: [{ otherId: a.id, role: "друзья", color: null }] } })).json();

  // edit from A's side
  await app.inject({ method: "PATCH", url: `/api/characters/${a.id}`, payload: { gender: "male", firstName: "A", lastName: "X", relations: [{ otherId: b.id, role: "враги", color: null }] } });

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0].role).toBe("враги");
});

test("does not create a duplicate edge for the reverse direction", async () => {
  const book = await createBook();
  const a = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "A", lastName: "X", relations: [] } })).json();
  const b = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "B", lastName: "X", relations: [{ otherId: a.id, role: "друзья", color: null }] } })).json();

  // A re-asserts the same pair -> still one edge
  await app.inject({ method: "PATCH", url: `/api/characters/${a.id}`, payload: { gender: "male", firstName: "A", lastName: "X", relations: [{ otherId: b.id, role: "друзья", color: null }] } });

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
});

test("stores relationships canonically (sourceId < targetId)", async () => {
  const book = await createBook();
  const a = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "A", lastName: "X", relations: [] } })).json();
  await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "B", lastName: "X", relations: [{ otherId: a.id, role: "друзья", color: null }] } });

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0].sourceId < graph.edges[0].targetId).toBe(true);
});
```

- [ ] **Step 8: Прогнать ВЕСЬ серверный пакет**

Run: `npm run test --workspace server`
Expected: PASS (все файлы, включая `api.test.ts` и `normalize.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add server/src/schemas.ts server/src/services/relationships.ts server/test/relationships.test.ts server/test/api.test.ts
git commit -m "feat(server): flat undirected relation wire-format + incident reconcile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Холст — ребро без стрелки (ненаправленное)

**Files:**
- Modify: `web/src/canvas/MindMap.tsx:63`
- Test: `web/src/canvas/__tests__/MindMap.test.tsx` (добавить тест)

**Interfaces:**
- Независима от изменений типов; стиль ребра `target-arrow-shape: "none"`.

- [ ] **Step 1: Написать падающий тест «у ребра нет стрелки»**

В `web/src/canvas/__tests__/MindMap.test.tsx` добавить в конец файла:

```ts
test("renders edges without an arrowhead (undirected)", () => {
  const graph: BookGraph = {
    nodes: [
      { id: "c1", bookId: "b1", gender: "male", firstName: "A", lastName: "X" },
      { id: "c2", bookId: "b1", gender: "female", firstName: "B", lastName: "Y" },
    ],
    edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null }],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} />);
  const cy = instances[0];
  expect(cy.getElementById("e1").style("target-arrow-shape")).toBe("none");
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test --workspace web -- MindMap`
Expected: FAIL — `expected 'triangle' to be 'none'`.

- [ ] **Step 3: Поменять стиль ребра**

В `web/src/canvas/MindMap.tsx` строку 63 заменить:

```ts
            "target-arrow-shape": "triangle",
```

на:

```ts
            "target-arrow-shape": "none",
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm run test --workspace web -- MindMap`
Expected: PASS (включая существующий тест tap-wiring).

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/MindMap.tsx web/src/canvas/__tests__/MindMap.test.tsx
git commit -m "feat(web): draw relationship edges without arrowheads (undirected)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Веб — плоский тип связи, инцидентные связи, карточка «строки»

Это единая атомарная задача: тип `RelationConnection` используется в 5 файлах, удаление `RelationEntry`/`RelationTarget` требует одновременной правки всех потребителей, иначе `tsc` не соберётся.

**Files:**
- Modify: `web/src/types.ts:37-47`
- Modify: `web/src/lib/relations.ts` (весь файл)
- Test: `web/src/lib/__tests__/relations.test.ts` (весь файл)
- Modify: `web/src/api/client.ts:1,39`
- Modify: `web/src/components/RelationsModal.tsx` (весь файл)
- Test: `web/src/components/__tests__/RelationsModal.test.tsx` (весь файл)
- Modify: `web/src/components/CharacterModal.tsx:7,46`
- Modify: `web/src/screens/BookScreen.tsx:11,40`

**Interfaces:**
- Consumes: серверный wire-формат `{ otherId, role, color }` (Task 2).
- Produces:
  - `type RelationConnection = { otherId: string; role: string; color: string | null }` (`web/src/types.ts`).
  - `incidentConnections(characterId: string, edges: Relationship[]): RelationConnection[]` (`web/src/lib/relations.ts`).
  - `RelationsModal` props: `{ open; others: Character[]; value: RelationConnection[]; onCancel; onSave: (connections: RelationConnection[]) => void }`.
  - `CharacterInput.relations: RelationConnection[]` (`web/src/api/client.ts`).

- [ ] **Step 1: Заменить тип связи в types.ts**

В `web/src/types.ts` заменить блок строк 37-47:

```ts
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

на:

```ts
/** One undirected connection from a character's perspective:
 *  the other endpoint, a symmetric label, and the line colour (null = default). */
export interface RelationConnection {
  otherId: string;
  role: string;
  color: string | null;
}
```

- [ ] **Step 2: Заменить тест relations.ts (падающий)**

Заменить весь `web/src/lib/__tests__/relations.test.ts`:

```ts
import { expect, test } from "vitest";
import { incidentConnections } from "../relations.js";
import type { Relationship } from "../../types.js";

const edge = (
  id: string, sourceId: string, targetId: string, role: string, color: string | null = null,
): Relationship => ({ id, bookId: "b", sourceId, targetId, role, color });

test("collects a connection where the character is the source", () => {
  const edges = [edge("e1", "v", "p", "друзья", "#ff0000")];
  expect(incidentConnections("v", edges)).toEqual([{ otherId: "p", role: "друзья", color: "#ff0000" }]);
});

test("collects a connection where the character is the target (other side)", () => {
  const edges = [edge("e1", "p", "v", "семья")];
  expect(incidentConnections("v", edges)).toEqual([{ otherId: "p", role: "семья", color: null }]);
});

test("collects connections from both sides, preserving edge order", () => {
  const edges = [edge("e1", "v", "p", "друзья"), edge("e2", "z", "v", "семья")];
  expect(incidentConnections("v", edges)).toEqual([
    { otherId: "p", role: "друзья", color: null },
    { otherId: "z", role: "семья", color: null },
  ]);
});

test("ignores edges that don't touch the character", () => {
  const edges = [edge("e1", "p", "z", "друзья")];
  expect(incidentConnections("v", edges)).toEqual([]);
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npm run test --workspace web -- relations.test`
Expected: FAIL — `incidentConnections` не экспортируется.

- [ ] **Step 4: Переписать relations.ts**

Заменить весь `web/src/lib/relations.ts`:

```ts
import type { Relationship, RelationConnection } from "../types.js";

/**
 * All undirected connections incident to `characterId` (either endpoint).
 * `otherId` is the opposite node, so connections created "from the other side"
 * are visible too. Edges arrive sorted by createdAt -> stable order.
 */
export function incidentConnections(characterId: string, edges: Relationship[]): RelationConnection[] {
  const out: RelationConnection[] = [];
  for (const e of edges) {
    if (e.sourceId === characterId) out.push({ otherId: e.targetId, role: e.role, color: e.color ?? null });
    else if (e.targetId === characterId) out.push({ otherId: e.sourceId, role: e.role, color: e.color ?? null });
  }
  return out;
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `npm run test --workspace web -- relations.test`
Expected: PASS.

- [ ] **Step 6: Обновить api/client.ts**

В `web/src/api/client.ts` строку 1 заменить:

```ts
import type { Book, BookGraph, Character, RelationEntry } from "../types.js";
```

на:

```ts
import type { Book, BookGraph, Character, RelationConnection } from "../types.js";
```

И строку 39 (`relations: RelationEntry[];`) заменить на:

```ts
  relations: RelationConnection[];
```

- [ ] **Step 7: Переписать RelationsModal на строки**

Заменить весь `web/src/components/RelationsModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, MenuItem, Menu, Stack, Typography, Popper, Paper, ClickAwayListener,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Wheel, ShadeSlider, hexToHsva, hsvaToHex } from "@uiw/react-color";
import type { Character, RelationConnection } from "../types.js";
import { EDGE_COLOR } from "../theme.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

interface Props {
  open: boolean;
  others: Character[];
  value: RelationConnection[];
  onCancel: () => void;
  onSave: (connections: RelationConnection[]) => void;
}

interface Picker { otherId: string; anchor: HTMLElement }

export function RelationsModal({ open, others, value, onCancel, onSave }: Props) {
  const [rows, setRows] = useState<RelationConnection[]>(value);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [draft, setDraft] = useState(EDGE_COLOR);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => { if (open) setRows(value); }, [open]);

  useBackClose(open, onCancel);
  useBackClose(!!picker, () => setPicker(null));
  useBackClose(!!addAnchor, () => setAddAnchor(null));

  const nameOf = (id: string) => {
    const c = others.find((o) => o.id === id);
    return c ? `${c.firstName} ${c.lastName ?? ""}`.trim() : id;
  };

  const connectedIds = new Set(rows.map((r) => r.otherId));
  const available = others.filter((o) => !connectedIds.has(o.id));

  const addConnection = (otherId: string) => {
    setRows((rs) => [...rs, { otherId, role: "", color: null }]);
    setAddAnchor(null);
  };
  const removeRow = (otherId: string) => setRows((rs) => rs.filter((r) => r.otherId !== otherId));
  const setRole = (otherId: string, role: string) =>
    setRows((rs) => rs.map((r) => (r.otherId === otherId ? { ...r, role } : r)));
  const setColor = (otherId: string, color: string) =>
    setRows((rs) => rs.map((r) => (r.otherId === otherId ? { ...r, color } : r)));

  const openPicker = (otherId: string, anchor: HTMLElement) => {
    setDraft(rows.find((r) => r.otherId === otherId)?.color ?? EDGE_COLOR);
    setPicker({ otherId, anchor });
  };

  const validDraft = HEX.test(draft) ? draft : EDGE_COLOR;
  const applyHsva = (patch: { h?: number; s?: number; v?: number }) => {
    if (!picker) return;
    const next = hsvaToHex({ ...hexToHsva(validDraft), ...patch });
    setDraft(next);
    setColor(picker.otherId, next);
  };
  const onHexInput = (v: string) => {
    setDraft(v);
    if (HEX.test(v) && picker) setColor(picker.otherId, v);
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Связи</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Связь общая для пары персонажей. Роль — симметричная метка (например «друзья», «семья»).
        </Typography>
        <Stack spacing={2}>
          {rows.map((row) => (
            <Box key={row.otherId} sx={{ p: 2, border: "1px solid #eee", borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>{nameOf(row.otherId)}</Typography>
                <IconButton
                  aria-label={`цвет линии для ${nameOf(row.otherId)}`}
                  onClick={(ev) => openPicker(row.otherId, ev.currentTarget)}
                >
                  <Box sx={{
                    width: 22, height: 22, borderRadius: "50%",
                    bgcolor: row.color ?? EDGE_COLOR, border: "1px solid #ccc",
                  }} />
                </IconButton>
                <IconButton
                  aria-label={`удалить связь с ${nameOf(row.otherId)}`}
                  onClick={() => removeRow(row.otherId)}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
              <TextField
                label="Роль"
                value={row.role}
                inputProps={{ maxLength: 30 }}
                helperText="Необязательно"
                onChange={(e) => setRole(row.otherId, e.target.value)}
                fullWidth
                sx={{ mt: 2 }}
              />
            </Box>
          ))}
        </Stack>
        {available.length > 0 && (
          <>
            <Button sx={{ mt: 2 }} onClick={(e) => setAddAnchor(e.currentTarget)}>
              + Добавить связь
            </Button>
            <Menu anchorEl={addAnchor} open={!!addAnchor} onClose={() => setAddAnchor(null)}>
              {available.map((o) => (
                <MenuItem key={o.id} onClick={() => addConnection(o.id)}>
                  {`${o.firstName} ${o.lastName ?? ""}`.trim()}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(rows)}>Сохранить</Button>
      </DialogActions>

      <Popper open={!!picker} anchorEl={picker?.anchor ?? null} placement="bottom" sx={{ zIndex: 1400 }}>
        <ClickAwayListener onClickAway={() => setPicker(null)}>
          <Paper sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
            <Wheel color={hexToHsva(validDraft)} onChange={(c) => applyHsva({ h: c.hsva.h, s: c.hsva.s })} />
            <ShadeSlider hsva={hexToHsva(validDraft)} style={{ width: 210 }} onChange={(s) => applyHsva(s)} />
            <TextField label="HEX" size="small" value={draft} onChange={(e) => onHexInput(e.target.value)} sx={{ width: 210 }} />
          </Paper>
        </ClickAwayListener>
      </Popper>
    </Dialog>
  );
}
```

- [ ] **Step 8: Переписать тест RelationsModal**

Заменить весь `web/src/components/__tests__/RelationsModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RelationsModal } from "../RelationsModal.js";
import type { Character } from "../../types.js";
import { __resetBackStack } from "../../lib/backStack.js";

// Wheel/shade are third-party canvas-ish widgets; mock them so the modal state is
// exercised via the HEX input deterministically.
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

test("adds a connection via the menu and returns it on save", async () => {
  const onSave = vi.fn();
  render(<RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /жанна/i }));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ otherId: "z", role: "", color: null }]);
});

test("hides already-connected characters from the add menu", async () => {
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "", color: null }]}
      onCancel={() => {}} onSave={() => {}} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  expect(screen.queryByRole("menuitem", { name: /петя/i })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /жанна/i })).toBeInTheDocument();
});

test("edits the role of a connection", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "", color: null }]}
      onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.type(screen.getByLabelText(/роль/i), "друзья");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ otherId: "p", role: "друзья", color: null }]);
});

test("picks a colour for a connection via the hex input", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "друзья", color: null }]}
      onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /цвет линии для Петя П/i }));
  const hex = screen.getByLabelText(/hex/i);
  await userEvent.clear(hex);
  await userEvent.type(hex, "#112233");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ otherId: "p", role: "друзья", color: "#112233" }]);
});

test("removes a connection", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "друзья", color: null }]}
      onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /удалить связь с Петя П/i }));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([]);
});

test("the role field is marked optional", () => {
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "", color: null }]}
      onCancel={() => {}} onSave={() => {}} />,
  );
  expect(screen.getByText(/необязательно/i)).toBeInTheDocument();
});

test("Back button cancels the relations modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<RelationsModal open others={others} value={[]} onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 9: Обновить тип состояния в CharacterModal**

В `web/src/components/CharacterModal.tsx` строку 7 заменить:

```ts
import type { Character, Gender, RelationEntry } from "../types.js";
```

на:

```ts
import type { Character, Gender, RelationConnection } from "../types.js";
```

И строку 46 заменить:

```ts
  const [relations, setRelations] = useState<RelationEntry[]>(initial?.relations ?? empty.relations);
```

на:

```ts
  const [relations, setRelations] = useState<RelationConnection[]>(initial?.relations ?? empty.relations);
```

(Счётчик «Связи ({relations.length})» и проброс в `RelationsModal` менять не нужно — `relations` уже плоский список соединений.)

- [ ] **Step 10: Переключить BookScreen на incidentConnections**

В `web/src/screens/BookScreen.tsx` строку 11 заменить:

```ts
import { groupEdges } from "../lib/relations.js";
```

на:

```ts
import { incidentConnections } from "../lib/relations.js";
```

И строку 40 заменить:

```ts
    relations: groupEdges(modal.character.id, graph.edges),
```

на:

```ts
    relations: incidentConnections(modal.character.id, graph.edges),
```

- [ ] **Step 11: Проверить типизацию всего web-пакета**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: без ошибок (нет осиротевших ссылок на `RelationEntry`/`RelationTarget`/`groupEdges`/`expandEntries`).

- [ ] **Step 12: Прогнать ВЕСЬ web-пакет**

Run: `npm run test --workspace web`
Expected: PASS (relations, RelationsModal, CharacterModal, BookScreen, MindMap и др.).

- [ ] **Step 13: Commit**

```bash
git add web/src/types.ts web/src/lib/relations.ts web/src/lib/__tests__/relations.test.ts web/src/api/client.ts web/src/components/RelationsModal.tsx web/src/components/__tests__/RelationsModal.test.tsx web/src/components/CharacterModal.tsx web/src/screens/BookScreen.tsx
git commit -m "feat(web): undirected single relationship per pair (flat connections + row UI)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Документация (CLAUDE.md)

**Files:**
- Modify: `CLAUDE.md` (раздел Schema, Gotchas, Status)

**Interfaces:**
- Только текст; код не трогаем.

- [ ] **Step 1: Обновить описание схемы `Relationship`**

В `CLAUDE.md`, в абзаце **Schema** (раздел Architecture), заменить предложение, начинающееся с «A directed relationship edge means…», на описание ненаправленной связи:

```text
A `Relationship` row is an **undirected** edge: exactly **one row per unordered pair** of characters. `sourceId`/`targetId` are stored **canonically** (`sourceId` = lexicographically smaller id, `targetId` = larger) — direction carries no meaning, they are just the two ends. Uniqueness is enforced by `@@unique([sourceId, targetId])`. `role` is a **symmetric label** (e.g. "друзья", "семья"), `NOT NULL` but **accepts an empty string `""`** (an unlabelled line, max 30), and carries an optional `color` (hex `#rrggbb`, nullable) for its canvas line; `null` renders with the default `EDGE_COLOR`.
```

- [ ] **Step 2: Обновить заметку про холст в Status**

В разделе **Status**, в перечне фич, заменить «per-edge relationship line colours» окружение так, чтобы упомянуть ненаправленность: добавить «undirected single relationship per character pair (arrowless lines)» в список.

- [ ] **Step 3: Заменить gotcha про wire-формат связей**

Заменить gotcha «**Relations wire shape is tested in two places**» на:

```text
- **Relations wire shape is tested in two places** — the relations payload is now a **flat list of connections** (`{ otherId, role, color }`, validated by `relationConnectionSchema`), exercised by both `server/test/relationships.test.ts` (the service directly) **and** `server/test/api.test.ts` (end-to-end). When you change the shape, update *both* — a focused `relationships` run goes green while `api.test.ts` posts the old shape and 400s. Run the **full** `npm run test --workspace server` before declaring a schema/validation change done.
```

- [ ] **Step 4: Заменить gotcha про reconcile**

Заменить gotcha «**Relationship colour & reconcile**» на:

```text
- **Undirected reconcile (incident edges + canonical order)** — `Relationship.color` is nullable (`null` = default `EDGE_COLOR`, never written). `reconcileRelationships(tx, bookId, characterId, connections)` looks at **both endpoints** (`sourceId == characterId` OR `targetId == characterId`), keying edges by `otherId`; it **creates missing edges in canonical order** (`min/max` of the pair so `sourceId < targetId`), deletes incident edges whose other end isn't desired, and **updates `role`/`color`** on changed rows (a connection re-roled "from the other side" updates the same row). Self-targets are ignored. Because both sides are inspected, an edge created from the other character is seen and never duplicated.
```

- [ ] **Step 5: Обновить заметку про пустую роль**

Заменить gotcha «**Empty role is `""`, never `NULL`**» так, чтобы убрать упоминание `@@unique([sourceId, targetId, role])` и направленности:

```text
- **Empty role is `""`, never `NULL`** — `relationConnectionSchema.role` is `z.string().trim().max(30).optional().default("")`, so an omitted/blank role stores `""` (a bare, arrowless line). `@@unique([sourceId, targetId])` (with canonical storage) already forbids a second edge per pair, so role is a pure label. The «Роль» field in `RelationsModal` is marked «Необязательно».
```

- [ ] **Step 6: Добавить заметку про холст и про normalize**

Добавить две новые gotcha-заметки в список:

```text
- **Edges are undirected (no arrowhead)** — `MindMap.tsx` edge style sets `target-arrow-shape: "none"`; `line-color`/`label`/colour are unchanged. `graphAdapter.ts` still maps `sourceId`→`source`, `targetId`→`target` (Cytoscape needs both ends), but the rendered line has no direction. `web/src/canvas/__tests__/MindMap.test.tsx` asserts `style("target-arrow-shape") === "none"`.
- **Legacy normalization before `db push`** — `server/src/server.ts` calls `normalizeRelationships()` (`server/src/services/normalize.ts`) **before** `prisma db push` on boot. It's idempotent and guarded by "the `Relationship` table exists" (fresh DB → no-op): it collapses duplicate unordered pairs (keeping the **earliest** by `createdAt`) and canonicalises survivors (`sourceId < targetId`), so the new `@@unique([sourceId, targetId])` index can be created on existing volumes. SQLite evaluates `UPDATE ... SET sourceId = targetId, targetId = sourceId` against pre-update values, so the swap is correct.
```

Также в gotcha «**Relations modal picker is a `Popper`, not a `Popover`**» оставить как есть (поведение сохранено).

- [ ] **Step 7: Удалить устаревшую заметку про направленность из «Book rename»/прочего, если осталась**

Run: `grep -n "directed\|target-arrow-shape: triangle\|sourceId, targetId, role\|groupEdges\|expandEntries\|RelationEntry\|RelationTarget" CLAUDE.md`
Expected: пусто (никаких устаревших упоминаний). Если что-то найдено — поправить формулировку на ненаправленную/плоскую.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document undirected single relationship, flat wire shape, normalize step

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Финальная проверка (после всех задач)

- [ ] **Полный прогон тестов обоих пакетов**

Run: `npm test`
Expected: PASS (server + web).

- [ ] **Сборка (ловит то, что Vitest пропускает)**

Run: `npm run build`
Expected: web-бандл собран, `tsc` сервера без ошибок.

- [ ] **(Опционально, требует Docker) e2e**

Run: `npm run test:e2e`
Expected: PASS.

---

## Self-Review (выполнено при составлении плана)

**1. Покрытие спецификации:**
- §1 Модель данных → Task 1 (Step 1, unique `[sourceId, targetId]`); каноническое хранение → Task 2 (reconcile) + Task 1 (normalize).
- §2 Миграция данных → Task 1 (`normalizeRelationships` + порядок `normalize → db push`).
- §3 Сервер (wire-формат, reconcile по инцидентным рёбрам, формат рёбер `getBookGraph` без изменений) → Task 2. `getBookGraph` намеренно не трогается.
- §4 Веб (типы, `incidentConnections`, `RelationsModal` строки, `MindMap` без стрелки, `CharacterModal` счётчик) → Task 3 (MindMap) + Task 4 (остальное).
- §5 Тройная гарантия → БД (Task 1 unique), Код (Task 2 reconcile), UI (Task 4 — скрытие связанных в меню «Добавить связь»).
- Тестирование (весь server-пакет; новые кейсы «видно с другой стороны», «нет дубля обратного направления», «каноническое хранение», `normalize`; web: нет связанных в выпадашке, `incidentConnections` обе стороны, ребро без стрелки) → Task 1/2/3/4.
- Документация → Task 5.

**2. Плейсхолдеры:** не обнаружено — каждый шаг с кодом содержит полный код и точную команду с ожидаемым результатом.

**3. Согласованность типов:** `RelationConnection = { otherId, role, color }` идентичен на сервере (`relationConnectionSchema`) и вебе (`web/src/types.ts`); `incidentConnections` возвращает именно его; `reconcileRelationships(tx, bookId, characterId, connections)` принимает его же; `CharacterInput.relations: RelationConnection[]`. Имена функций (`normalizeRelationships`, `incidentConnections`, `reconcileRelationships`) совпадают во всех ссылках.
