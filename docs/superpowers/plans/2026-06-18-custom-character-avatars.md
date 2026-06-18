# Custom Character Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload, circular-crop, and store a custom avatar image per character, replacing the schematic SVG, with cascade delete.

**Architecture:** Avatar bytes live in a new one-to-one `CharacterAvatar` table (separate from `Character` so the graph query never loads blobs). The browser validates the chosen file, crops/scales it inside a circle, and bakes the result to a 512×512 WebP; only that small blob is uploaded (base64 JSON) to a new set of avatar endpoints. The server stores the bytes and serves them from a dedicated endpoint used both as an `<img src>` and as the Cytoscape node `background-image`. No server-side image processing — pure-JS server preserved.

**Tech Stack:** Fastify 4, Prisma 5, SQLite (server); React 18 + TypeScript + MUI + Cytoscape.js + `react-easy-crop` (web); Vitest + Testing Library.

---

## Reference facts (read before starting)

- The server has **no migrations**; schema is applied by `prisma db push` at startup (`server/src/server.ts`) and in tests by `server/test/helpers.ts`. Never use `prisma migrate`.
- Prisma `Bytes` maps to a Node `Buffer`.
- Server tests boot the app via `server/test/helpers.ts` (`setupTestDb`, `makeApp`, `resetData`) and use `app.inject(...)`. `DATABASE_URL=file:./test.db` is forced by `server/vitest.config.ts`.
- The web `api` client (`web/src/api/client.ts`) sets `Content-Type: application/json` **only when a body is present** — preserve this.
- The Cytoscape node already renders `data(avatarUri)` with `background-fit: cover` on an ellipse, so a baked square image shows as a circle. **No `MindMap.tsx` change is needed.**
- Run server tests: `npm run test --workspace server -- <pattern>`. Run web tests: `npm run test --workspace web -- <pattern>`. Full suite: `npm test`.

## File structure

**Server**
- Modify `server/prisma/schema.prisma` — add `CharacterAvatar`, relation on `Character`.
- Modify `server/src/schemas.ts` — add `avatarUploadSchema` + size constants.
- Modify `server/src/routes/characters.ts` — add `PUT`/`GET`/`DELETE` `/api/characters/:id/avatar`.
- Modify `server/src/services/graph.ts` — include `avatar.updatedAt`, expose `avatarUpdatedAt`.
- Modify `server/test/helpers.ts` — clear `characterAvatar` in `resetData`.
- Create `server/test/avatar.test.ts` — endpoint + cascade + graph tests.

**Web**
- Modify `web/package.json` — add `react-easy-crop`.
- Modify `web/src/types.ts` — add `avatarUpdatedAt` to `Character`.
- Modify `web/src/api/client.ts` — `setAvatar`, `deleteAvatar`, `avatarUrl`.
- Create `web/src/lib/avatarImage.ts` — file/dimension validators, image loader, baker, constants.
- Modify `web/src/lib/graphAdapter.ts` — emit endpoint URL when `avatarUpdatedAt` set.
- Modify `web/src/components/Avatar.tsx` — optional `src` → `<img>`.
- Create `web/src/components/AvatarCropDialog.tsx` — circular crop UI.
- Modify `web/src/components/CharacterModal.tsx` — avatar menu + staging + widened `onSubmit`.
- Modify `web/src/screens/BookScreen.tsx` — reconcile avatar after submit.
- Create/modify tests alongside each.

---

## Task 1: Add `CharacterAvatar` schema + cascade

**Files:**
- Modify: `server/prisma/schema.prisma`
- Modify: `server/test/helpers.ts:20-26`

- [ ] **Step 1: Add the model and relation**

In `server/prisma/schema.prisma`, add to the `Character` model (after the `incoming` line, before its closing `}`):

```prisma
  avatar     CharacterAvatar?
```

Then append a new model at the end of the file:

```prisma
model CharacterAvatar {
  characterId String    @id
  data        Bytes
  mimeType    String
  width       Int
  height      Int
  updatedAt   DateTime  @updatedAt
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Clear avatars in the test reset helper**

In `server/test/helpers.ts`, update `resetData` so avatars are removed first (delete children before parents):

```ts
export async function resetData() {
  await prisma.characterAvatar.deleteMany();
  await prisma.relationship.deleteMany();
  await prisma.character.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
  await ensureDefaultUser();
}
```

- [ ] **Step 3: Regenerate client and push schema to verify it is valid**

Run: `npm install` (ensures workspace deps) then
`npx prisma generate --schema server/prisma/schema.prisma`
Expected: "Generated Prisma Client" with no errors.

Run: `DATABASE_URL=file:./test.db npx prisma db push --schema server/prisma/schema.prisma --force-reset --skip-generate`
Expected: "Your database is now in sync with your Prisma schema." and a `CharacterAvatar` table created.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/test/helpers.ts
git commit -m "feat(server): add CharacterAvatar table with cascade delete"
```

---

## Task 2: `PUT /api/characters/:id/avatar` (upload baked image)

**Files:**
- Modify: `server/src/schemas.ts`
- Modify: `server/src/routes/characters.ts`
- Create: `server/test/avatar.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/test/avatar.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, makeApp } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { setupTestDb(); app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => resetData());

async function makeCharacter() {
  const book = (await app.inject({ method: "POST", url: "/api/books", payload: { title: "B" } })).json();
  return (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "A", lastName: "B", relations: [] },
  })).json();
}

// 4 raw bytes, base64-encoded, stands in for a tiny WebP (server does not decode it).
const TINY = Buffer.from([1, 2, 3, 4]).toString("base64");
const validPayload = { data: TINY, mimeType: "image/webp", width: 512, height: 512 };

test("PUT stores a baked avatar and returns 200", async () => {
  const c = await makeCharacter();
  const res = await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });
  expect(res.statusCode).toBe(200);
});

test("PUT rejects non-webp mime with 400", async () => {
  const c = await makeCharacter();
  const res = await app.inject({
    method: "PUT", url: `/api/characters/${c.id}/avatar`,
    payload: { ...validPayload, mimeType: "image/png" },
  });
  expect(res.statusCode).toBe(400);
});

test("PUT rejects oversized dimensions with 400", async () => {
  const c = await makeCharacter();
  const res = await app.inject({
    method: "PUT", url: `/api/characters/${c.id}/avatar`,
    payload: { ...validPayload, width: 2000 },
  });
  expect(res.statusCode).toBe(400);
});

test("PUT rejects payload larger than the byte cap with 400", async () => {
  const c = await makeCharacter();
  // ~2.25 MB once base64-decoded, over the 2 MB cap.
  const big = "A".repeat(3_000_000);
  const res = await app.inject({
    method: "PUT", url: `/api/characters/${c.id}/avatar`,
    payload: { ...validPayload, data: big },
  });
  expect(res.statusCode).toBe(400);
});

test("PUT to a non-existent character returns 404", async () => {
  const res = await app.inject({ method: "PUT", url: `/api/characters/nope/avatar`, payload: validPayload });
  expect(res.statusCode).toBe(404);
});

test("PUT twice replaces the stored avatar (upsert)", async () => {
  const c = await makeCharacter();
  await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });
  const res = await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server -- avatar`
Expected: FAIL — the `PUT` route does not exist (404 on the "stores" test, etc.).

- [ ] **Step 3: Add the validation schema and caps**

In `server/src/schemas.ts`, append:

```ts
export const AVATAR_MIME = "image/webp";
export const AVATAR_MAX_DIM = 1024;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const avatarUploadSchema = z.object({
  data: z.string().min(1),
  mimeType: z.literal(AVATAR_MIME),
  width: z.number().int().positive().max(AVATAR_MAX_DIM),
  height: z.number().int().positive().max(AVATAR_MAX_DIM),
});

export type AvatarUpload = z.infer<typeof avatarUploadSchema>;
```

- [ ] **Step 4: Implement the PUT route**

In `server/src/routes/characters.ts`, update the import line and add the route inside `characterRoutes` (after the `pos` route, before `delete`):

```ts
import { characterCreateSchema, characterUpdateSchema, positionSchema, avatarUploadSchema, AVATAR_MAX_BYTES } from "../schemas.js";
```

```ts
  app.put<{ Params: { id: string } }>("/api/characters/:id/avatar", async (req, reply) => {
    const parsed = avatarUploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const buf = Buffer.from(parsed.data.data, "base64");
    if (buf.byteLength > AVATAR_MAX_BYTES) return reply.code(400).send({ error: "avatar too large" });

    const character = await prisma.character.findUnique({ where: { id: req.params.id } });
    if (!character) return reply.code(404).send({ error: "not found" });

    const { width, height, mimeType } = parsed.data;
    await prisma.characterAvatar.upsert({
      where: { characterId: req.params.id },
      create: { characterId: req.params.id, data: buf, mimeType, width, height },
      update: { data: buf, mimeType, width, height },
    });
    return reply.code(200).send({ ok: true });
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace server -- avatar`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/schemas.ts server/src/routes/characters.ts server/test/avatar.test.ts
git commit -m "feat(server): PUT character avatar with validation and byte cap"
```

---

## Task 3: `GET /api/characters/:id/avatar` (serve bytes)

**Files:**
- Modify: `server/src/routes/characters.ts`
- Modify: `server/test/avatar.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/avatar.test.ts`:

```ts
test("GET returns the stored bytes with the right content-type", async () => {
  const c = await makeCharacter();
  await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });
  const res = await app.inject({ method: "GET", url: `/api/characters/${c.id}/avatar` });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("image/webp");
  expect(Buffer.from(res.rawPayload).equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
});

test("GET returns 404 when the character has no avatar", async () => {
  const c = await makeCharacter();
  const res = await app.inject({ method: "GET", url: `/api/characters/${c.id}/avatar` });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server -- avatar`
Expected: FAIL — GET route missing (404 on the "returns bytes" test for the wrong reason / no content-type).

- [ ] **Step 3: Implement the GET route**

In `server/src/routes/characters.ts`, add (after the PUT route):

```ts
  app.get<{ Params: { id: string } }>("/api/characters/:id/avatar", async (req, reply) => {
    const avatar = await prisma.characterAvatar.findUnique({ where: { characterId: req.params.id } });
    if (!avatar) return reply.code(404).send({ error: "not found" });
    return reply
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .type(avatar.mimeType)
      .send(avatar.data);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server -- avatar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/characters.ts server/test/avatar.test.ts
git commit -m "feat(server): GET character avatar bytes"
```

---

## Task 4: `DELETE /api/characters/:id/avatar`

**Files:**
- Modify: `server/src/routes/characters.ts`
- Modify: `server/test/avatar.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/test/avatar.test.ts`:

```ts
test("DELETE removes the avatar and a subsequent GET is 404", async () => {
  const c = await makeCharacter();
  await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });
  const del = await app.inject({ method: "DELETE", url: `/api/characters/${c.id}/avatar` });
  expect(del.statusCode).toBe(204);
  const res = await app.inject({ method: "GET", url: `/api/characters/${c.id}/avatar` });
  expect(res.statusCode).toBe(404);
});

test("DELETE is a no-op 204 when there is no avatar", async () => {
  const c = await makeCharacter();
  const del = await app.inject({ method: "DELETE", url: `/api/characters/${c.id}/avatar` });
  expect(del.statusCode).toBe(204);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server -- avatar`
Expected: FAIL — DELETE route missing.

- [ ] **Step 3: Implement the DELETE route**

In `server/src/routes/characters.ts`, add (after the GET route):

```ts
  app.delete<{ Params: { id: string } }>("/api/characters/:id/avatar", async (req, reply) => {
    await prisma.characterAvatar.deleteMany({ where: { characterId: req.params.id } });
    return reply.code(204).send();
  });
```

(`deleteMany` makes the no-avatar case a clean no-op — no P2025.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server -- avatar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/characters.ts server/test/avatar.test.ts
git commit -m "feat(server): DELETE character avatar"
```

---

## Task 5: Cascade delete tests (character and book)

**Files:**
- Modify: `server/test/avatar.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/avatar.test.ts`:

```ts
test("deleting a character deletes its avatar row", async () => {
  const c = await makeCharacter();
  await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });
  await app.inject({ method: "DELETE", url: `/api/characters/${c.id}` });
  const { prisma } = await import("../src/db.js");
  expect(await prisma.characterAvatar.count()).toBe(0);
});

test("deleting a book deletes its characters' avatars", async () => {
  const book = (await app.inject({ method: "POST", url: "/api/books", payload: { title: "B2" } })).json();
  const c = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "female", firstName: "C", lastName: "D", relations: [] },
  })).json();
  await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });
  await app.inject({ method: "DELETE", url: `/api/books/${book.id}` });
  const { prisma } = await import("../src/db.js");
  expect(await prisma.characterAvatar.count()).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they pass (cascade already wired in Task 1)**

Run: `npm run test --workspace server -- avatar`
Expected: PASS. If they fail, the `onDelete: Cascade` on `CharacterAvatar.character` from Task 1 is missing — fix the schema and re-run `prisma db push --force-reset` against the test DB.

- [ ] **Step 3: Commit**

```bash
git add server/test/avatar.test.ts
git commit -m "test(server): verify avatar cascade delete via character and book"
```

---

## Task 6: Expose `avatarUpdatedAt` in the book graph

**Files:**
- Modify: `server/src/services/graph.ts`
- Modify: `server/test/avatar.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/avatar.test.ts`:

```ts
test("graph node carries avatarUpdatedAt and no avatar bytes", async () => {
  const book = (await app.inject({ method: "POST", url: "/api/books", payload: { title: "G" } })).json();
  const c = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "E", lastName: "F", relations: [] },
  })).json();
  await app.inject({ method: "PUT", url: `/api/characters/${c.id}/avatar`, payload: validPayload });

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  const node = graph.nodes.find((n: { id: string }) => n.id === c.id);
  expect(node.avatarUpdatedAt).toBeTruthy();
  expect(node).not.toHaveProperty("avatar");
  expect(JSON.stringify(graph)).not.toContain("AQIDBA=="); // the base64 bytes never leak
});

test("graph node avatarUpdatedAt is null when there is no avatar", async () => {
  const book = (await app.inject({ method: "POST", url: "/api/books", payload: { title: "G2" } })).json();
  await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "N", lastName: "O", relations: [] },
  });
  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes[0].avatarUpdatedAt).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server -- avatar`
Expected: FAIL — `avatarUpdatedAt` is `undefined` on the node.

- [ ] **Step 3: Implement the graph change**

Replace the body of `server/src/services/graph.ts`:

```ts
import { prisma } from "../db.js";

export async function getBookGraph(bookId: string) {
  const [rows, edges] = await Promise.all([
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
  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server -- avatar`
Expected: PASS.

- [ ] **Step 5: Run the full server suite (no regressions)**

Run: `npm run test --workspace server`
Expected: PASS (existing `api`, `graph`, `relationships` tests still green; graph nodes now additionally carry `avatarUpdatedAt`).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/graph.ts server/test/avatar.test.ts
git commit -m "feat(server): expose avatarUpdatedAt in book graph without loading bytes"
```

---

## Task 7: Add `react-easy-crop` and the web `avatarUpdatedAt` type

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/types.ts:9-19`

- [ ] **Step 1: Install the crop library**

Run: `npm install react-easy-crop --workspace web`
Expected: `react-easy-crop` appears under `web/package.json` `dependencies`.

- [ ] **Step 2: Add the field to the Character type**

In `web/src/types.ts`, add to the `Character` interface (after `posY`):

```ts
  avatarUpdatedAt?: string | null;
```

- [ ] **Step 3: Verify the web project still type-checks**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS (existing tests unaffected; new field is optional).

- [ ] **Step 4: Commit**

```bash
git add web/package.json package-lock.json web/src/types.ts
git commit -m "chore(web): add react-easy-crop and avatarUpdatedAt to Character"
```

---

## Task 8: API client — `setAvatar`, `deleteAvatar`, `avatarUrl`

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/api/__tests__/client.test.ts`:

```ts
test("avatarUrl includes the cache-busting version param", () => {
  expect(api.avatarUrl("c1", "2026-06-18T00:00:00.000Z")).toBe(
    "/api/characters/c1/avatar?v=2026-06-18T00%3A00%3A00.000Z",
  );
});

test("setAvatar PUTs a JSON body with base64 data and webp mime", async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" });
  await api.setAvatar("c1", blob);

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/characters/c1/avatar");
  expect(init.method).toBe("PUT");
  expect(headersOf([url, init])["Content-Type"]).toBe("application/json");
  const body = JSON.parse(init.body as string);
  expect(body.mimeType).toBe("image/webp");
  expect(typeof body.data).toBe("string");
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.width).toBe(512);
  expect(body.height).toBe(512);
});

test("deleteAvatar issues a bodyless DELETE without Content-Type", async () => {
  await api.deleteAvatar("c1");
  const call = fetchMock.mock.calls[0];
  expect(call[0]).toBe("/api/characters/c1/avatar");
  expect((call[1] as RequestInit).method).toBe("DELETE");
  expect(headersOf(call)["Content-Type"]).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace web -- client`
Expected: FAIL — `api.avatarUrl`/`setAvatar`/`deleteAvatar` are not functions.

- [ ] **Step 3: Implement the client methods**

In `web/src/api/client.ts`, add the constant and helper above the `api` object:

```ts
const AVATAR_SIZE = 512;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
```

Then add these entries inside the `api` object (after `deleteCharacter`):

```ts
  avatarUrl: (id: string, version: string) =>
    `/api/characters/${id}/avatar?v=${encodeURIComponent(version)}`,
  setAvatar: async (id: string, blob: Blob) => {
    const data = await blobToBase64(blob);
    return req<{ ok: true }>(`/api/characters/${id}/avatar`, {
      method: "PUT",
      body: JSON.stringify({ data, mimeType: "image/webp", width: AVATAR_SIZE, height: AVATAR_SIZE }),
    });
  },
  deleteAvatar: (id: string) =>
    req<void>(`/api/characters/${id}/avatar`, { method: "DELETE" }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/api/__tests__/client.test.ts
git commit -m "feat(web): api client setAvatar/deleteAvatar/avatarUrl"
```

---

## Task 9: Graph adapter — use the avatar endpoint URL when present

**Files:**
- Modify: `web/src/lib/graphAdapter.ts`
- Modify: `web/src/lib/__tests__/graphAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/__tests__/graphAdapter.test.ts`:

```ts
test("node with avatarUpdatedAt points avatarUri at the avatar endpoint", () => {
  const g: BookGraph = {
    nodes: [{ id: "c1", bookId: "b", gender: "male", firstName: "Я", lastName: "Я", avatarUpdatedAt: "2026-06-18T00:00:00.000Z" }],
    edges: [],
  };
  const node = toElements(g)[0];
  expect(node.data.avatarUri).toBe("/api/characters/c1/avatar?v=2026-06-18T00%3A00%3A00.000Z");
});

test("node without avatarUpdatedAt keeps the schematic data URI", () => {
  const g: BookGraph = {
    nodes: [{ id: "c1", bookId: "b", gender: "male", firstName: "Я", lastName: "Я", avatarUpdatedAt: null }],
    edges: [],
  };
  const node = toElements(g)[0];
  expect(node.data.avatarUri as string).toContain("data:image/svg+xml,");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — the avatarUpdatedAt node still gets a `data:` URI.

- [ ] **Step 3: Implement the adapter change**

In `web/src/lib/graphAdapter.ts`, update the imports and the `avatarUri` assignment:

```ts
import type { BookGraph } from "../types.js";
import { avatarKey } from "./avatar.js";
import { avatarSvgMarkup } from "./avatarSvg.js";
import { api } from "../api/client.js";
```

Replace the `avatarUri` line inside the node `data` object with:

```ts
        avatarUri: c.avatarUpdatedAt
          ? api.avatarUrl(c.id, c.avatarUpdatedAt)
          : "data:image/svg+xml," + encodeURIComponent(avatarSvgMarkup(c.gender, c.age)),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS (including the existing schematic-URI tests, since those nodes have no `avatarUpdatedAt`).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/graphAdapter.ts web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): graph adapter serves custom avatar endpoint URL on canvas"
```

---

## Task 10: Avatar image validation + baking module

**Files:**
- Create: `web/src/lib/avatarImage.ts`
- Create: `web/src/lib/__tests__/avatarImage.test.ts`

Note: `validateFileBasics` and `validateDimensions` are pure and unit-tested. `loadImage` and `bakeToWebp` use the DOM `<canvas>`/`Image`, which jsdom does not implement; they are thin wrappers verified by manual/e2e checks (Task 15), not unit tests.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/__tests__/avatarImage.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  validateFileBasics, validateDimensions, ACCEPT_ATTR, MAX_FILE_BYTES, MIN_DIM, MAX_DIM,
} from "../avatarImage.js";

function fileOfType(type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], "a", { type });
}

test("accepts a small png", () => {
  expect(validateFileBasics(fileOfType("image/png"))).toBeNull();
});

test("rejects an unsupported type", () => {
  expect(validateFileBasics(fileOfType("application/pdf"))).toMatch(/формат|тип/i);
});

test("rejects a file over the size cap", () => {
  const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big", { type: "image/png" });
  expect(validateFileBasics(big)).toMatch(/15|МБ|размер/i);
});

test("dimension check passes at the boundaries", () => {
  expect(validateDimensions(MIN_DIM, MIN_DIM)).toBeNull();
  expect(validateDimensions(MAX_DIM, MAX_DIM)).toBeNull();
});

test("dimension check rejects too small and too large", () => {
  expect(validateDimensions(MIN_DIM - 1, MIN_DIM)).toMatch(/64/);
  expect(validateDimensions(MAX_DIM + 1, MAX_DIM)).toMatch(/3000/);
});

test("ACCEPT_ATTR lists the five accepted image types", () => {
  expect(ACCEPT_ATTR).toContain("image/jpeg");
  expect(ACCEPT_ATTR).toContain("image/png");
  expect(ACCEPT_ATTR).toContain("image/gif");
  expect(ACCEPT_ATTR).toContain("image/svg+xml");
  expect(ACCEPT_ATTR).toContain("image/webp");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace web -- avatarImage`
Expected: FAIL — module `../avatarImage.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `web/src/lib/avatarImage.ts`:

```ts
export const AVATAR_SIZE = 512;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MIN_DIM = 64;
export const MAX_DIM = 3000;

export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/svg+xml",
  "image/webp",
] as const;

export const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");

/** Returns an error message, or null when the file passes type+size checks. */
export function validateFileBasics(file: File): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Неподдерживаемый формат. Разрешены JPG, PNG, GIF, SVG, WEBP.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Файл больше 15 МБ.";
  }
  return null;
}

/** Returns an error message, or null when raster dimensions are within bounds. */
export function validateDimensions(width: number, height: number): string | null {
  if (width < MIN_DIM || height < MIN_DIM) {
    return "Изображение меньше 64×64 пикселей.";
  }
  if (width > MAX_DIM || height > MAX_DIM) {
    return "Изображение больше 3000×3000 пикселей.";
  }
  return null;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Loads a file into an HTMLImageElement (object URL revoked on settle). */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось загрузить изображение.")); };
    img.src = url;
  });
}

/**
 * Bakes the given crop area of `img` into an AVATAR_SIZE square WebP.
 * `area` is in source-image pixel coordinates (as produced by react-easy-crop's
 * croppedAreaPixels). Animated GIFs collapse to their first frame; SVGs rasterize.
 */
export function bakeToWebp(img: HTMLImageElement, area: CropArea): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas не поддерживается."));
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Не удалось создать изображение."))),
      "image/webp",
      0.9,
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- avatarImage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/avatarImage.ts web/src/lib/__tests__/avatarImage.test.ts
git commit -m "feat(web): avatar file validation and WebP baking helpers"
```

---

## Task 11: `Avatar` component renders an `<img>` when `src` is given

**Files:**
- Modify: `web/src/components/Avatar.tsx`
- Modify: `web/src/components/__tests__/Avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/__tests__/Avatar.test.tsx`:

```ts
test("renders an img with circular mask when src is provided", () => {
  render(<Avatar gender="male" age={30} size={48} src="/api/characters/c1/avatar?v=1" />);
  const el = screen.getByTestId("avatar-img") as HTMLImageElement;
  expect(el.tagName).toBe("IMG");
  expect(el.getAttribute("src")).toBe("/api/characters/c1/avatar?v=1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- Avatar`
Expected: FAIL — no element with test id `avatar-img`.

- [ ] **Step 3: Implement the component change**

Replace the body of `web/src/components/Avatar.tsx`:

```tsx
import type { Gender } from "../types.js";
import { avatarKey } from "../lib/avatar.js";
import { avatarSvgMarkup } from "../lib/avatarSvg.js";

interface Props {
  gender: Gender;
  age?: number | null;
  size?: number;
  src?: string | null;
}

export function Avatar({ gender, age, size = 56, src }: Props) {
  if (src) {
    return (
      <img
        data-testid="avatar-img"
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "inline-block" }}
      />
    );
  }
  return (
    <span
      data-testid="avatar"
      data-avatar={avatarKey(gender, age)}
      aria-label={avatarKey(gender, age)}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: avatarSvgMarkup(gender, age) }}
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- Avatar`
Expected: PASS (both the new test and the existing schematic test).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Avatar.tsx web/src/components/__tests__/Avatar.test.tsx
git commit -m "feat(web): Avatar renders custom image when src provided"
```

---

## Task 12: `AvatarCropDialog` component

**Files:**
- Create: `web/src/components/AvatarCropDialog.tsx`
- Create: `web/src/components/__tests__/AvatarCropDialog.test.tsx`

Note: the live crop interaction (drag/zoom) relies on `react-easy-crop` + canvas, untestable in jsdom. The unit test covers wiring: Cancel calls `onCancel`; the title and controls render. The baked-blob save path is exercised manually/e2e (Task 15).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/AvatarCropDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AvatarCropDialog } from "../AvatarCropDialog.js";

// react-easy-crop needs layout APIs jsdom lacks; stub it to a noop.
vi.mock("react-easy-crop", () => ({ default: () => <div data-testid="cropper" /> }));

const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

test("renders the crop dialog and Cancel calls onCancel", async () => {
  const onCancel = vi.fn();
  render(<AvatarCropDialog open file={file} onCancel={onCancel} onSave={() => {}} />);
  expect(screen.getByTestId("cropper")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /отмена/i }));
  expect(onCancel).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- AvatarCropDialog`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `web/src/components/AvatarCropDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import Cropper from "react-easy-crop";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Slider, Box } from "@mui/material";
import { bakeToWebp, loadImage, type CropArea } from "../lib/avatarImage.js";

interface Props {
  open: boolean;
  file: File | null;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}

export function AvatarCropDialog({ open, file, onCancel, onSave }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState(false);

  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  // Reset transform whenever a new file is chosen.
  useEffect(() => { setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null); }, [file]);

  const save = async () => {
    if (!file || !area) return;
    setBusy(true);
    try {
      const img = await loadImage(file);
      const blob = await bakeToWebp(img, area);
      onSave(blob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Кадрирование</DialogTitle>
      <DialogContent>
        <Box sx={{ position: "relative", width: "100%", height: 300, bgcolor: "#222", borderRadius: 1 }}>
          {url && (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_a: CropArea, pixels: CropArea) => setArea(pixels)}
            />
          )}
        </Box>
        <Slider
          aria-label="Масштаб"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(_e, v) => setZoom(v as number)}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={save} disabled={busy || !area}>Сохранить</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- AvatarCropDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AvatarCropDialog.tsx web/src/components/__tests__/AvatarCropDialog.test.tsx
git commit -m "feat(web): AvatarCropDialog circular crop UI"
```

---

## Task 13: `CharacterModal` — avatar menu, staging, widened `onSubmit`

**Files:**
- Modify: `web/src/components/CharacterModal.tsx`
- Modify: `web/src/components/__tests__/CharacterModal.test.tsx`

- [ ] **Step 1: Write/update the tests**

Replace the entire contents of `web/src/components/__tests__/CharacterModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CharacterModal } from "../CharacterModal.js";

vi.mock("../AvatarCropDialog.js", () => ({ AvatarCropDialog: () => null }));

test("blocks save until required fields are valid, then submits input with no avatar change", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal open mode="create" others={[]} onCancel={() => {}} onSubmit={onSubmit} onDelete={undefined} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));
  expect(onSubmit).not.toHaveBeenCalled();

  await userEvent.click(screen.getByLabelText(/пол/i));
  await userEvent.click(screen.getByRole("option", { name: /мужчина/i }));
  await userEvent.type(screen.getByLabelText(/имя/i), "Вася");
  await userEvent.type(screen.getByLabelText(/фамилия/i), "Петров");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$|^добавить$/i }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ gender: "male", firstName: "Вася", lastName: "Петров", relations: [] }),
    { kind: "none" },
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
  expect(screen.getByRole("button", { name: /^удалить$/i })).toBeInTheDocument();
});

test("avatar menu offers Add when the character has no custom avatar", async () => {
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", relations: [] }}
      characterId="c1"
      onCancel={() => {}} onSubmit={() => {}} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByTestId("avatar-button"));
  expect(screen.getByRole("menuitem", { name: /добавить/i })).toBeInTheDocument();
});

test("avatar menu offers Change/Remove when a custom avatar exists, and Remove stages a removal", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", relations: [] }}
      characterId="c1" avatarUpdatedAt="2026-06-18T00:00:00.000Z"
      onCancel={() => {}} onSubmit={onSubmit} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByTestId("avatar-button"));
  expect(screen.getByRole("menuitem", { name: /изменить/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: /удалить/i }));

  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSubmit).toHaveBeenCalledWith(expect.any(Object), { kind: "remove" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace web -- CharacterModal`
Expected: FAIL — `onSubmit` is called with one arg; no `avatar-button`; no menu.

- [ ] **Step 3: Implement the modal changes**

Replace the entire contents of `web/src/components/CharacterModal.tsx`:

```tsx
import { useMemo, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  MenuItem, Stack, Box, IconButton, Menu,
} from "@mui/material";
import type { Character, Gender, RelationEntry } from "../types.js";
import { characterFormSchema } from "../lib/validation.js";
import { Avatar } from "./Avatar.js";
import { RelationsModal } from "./RelationsModal.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { AvatarCropDialog } from "./AvatarCropDialog.js";
import { ACCEPT_ATTR, validateFileBasics, validateDimensions, loadImage } from "../lib/avatarImage.js";
import { api } from "../api/client.js";
import type { CharacterInput } from "../api/client.js";

export type AvatarChange =
  | { kind: "none" }
  | { kind: "set"; blob: Blob }
  | { kind: "remove" };

interface Props {
  open: boolean;
  mode: "create" | "edit";
  others: Character[];
  initial?: CharacterInput;
  characterId?: string;
  avatarUpdatedAt?: string | null;
  onCancel: () => void;
  onSubmit: (input: CharacterInput, avatar: AvatarChange) => void;
  onDelete?: () => void;
}

const empty: CharacterInput = {
  gender: "male", firstName: "", lastName: "", middleName: "", age: null, relations: [],
};

export function CharacterModal({
  open, mode, others, initial, characterId, avatarUpdatedAt, onCancel, onSubmit, onDelete,
}: Props) {
  const [gender, setGender] = useState<Gender | "">(initial?.gender ?? "");
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [middleName, setMiddleName] = useState(initial?.middleName ?? "");
  const [age, setAge] = useState(initial?.age != null ? String(initial.age) : "");
  const [relations, setRelations] = useState<RelationEntry[]>(initial?.relations ?? empty.relations);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Avatar staging.
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "none" });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const hasCustom =
    avatar.kind === "set" || (avatar.kind !== "remove" && !!avatarUpdatedAt);

  const blobUrl = useMemo(
    () => (avatar.kind === "set" ? URL.createObjectURL(avatar.blob) : null),
    [avatar],
  );
  const avatarSrc =
    avatar.kind === "set" ? blobUrl
    : avatar.kind === "remove" ? null
    : avatarUpdatedAt && characterId ? api.avatarUrl(characterId, avatarUpdatedAt)
    : null;

  const pickFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ""; // allow re-picking the same file
    if (!file) return;
    setAvatarError(null);
    const basic = validateFileBasics(file);
    if (basic) { setAvatarError(basic); return; }
    if (file.type === "image/svg+xml") { setCropFile(file); return; } // no pixel dims to check
    loadImage(file)
      .then((img) => {
        const dimErr = validateDimensions(img.naturalWidth, img.naturalHeight);
        if (dimErr) { setAvatarError(dimErr); return; }
        setCropFile(file);
      })
      .catch(() => setAvatarError("Не удалось загрузить изображение."));
  };

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
    }, avatar);
  };

  return (
    <>
      <Dialog open={open} onClose={onCancel} fullScreen={false} fullWidth maxWidth="sm"
        PaperProps={{ sx: { maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 32px)" } }}>
        <DialogTitle>{mode === "create" ? "Новый персонаж" : "Персонаж"}</DialogTitle>
        <DialogContent dividers sx={{ overflowY: "auto" }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {gender && (
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
                <IconButton
                  data-testid="avatar-button"
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                  sx={{ p: 0, borderRadius: "50%" }}
                  aria-label="Аватар"
                >
                  <Avatar gender={gender as Gender} age={age === "" ? null : Number(age)} src={avatarSrc} />
                </IconButton>
                {avatarError && (
                  <Box sx={{ color: "error.main", fontSize: 12, textAlign: "center" }}>{avatarError}</Box>
                )}
              </Box>
            )}
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

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        {hasCustom
          ? [
              <MenuItem key="change" component="label">
                Изменить
                <input hidden type="file" accept={ACCEPT_ATTR}
                  onChange={(e) => { setMenuAnchor(null); pickFile(e.currentTarget); }} />
              </MenuItem>,
              <MenuItem key="remove" onClick={() => { setAvatar({ kind: "remove" }); setMenuAnchor(null); }}>
                Удалить
              </MenuItem>,
            ]
          : (
            <MenuItem key="add" component="label">
              Добавить
              <input hidden type="file" accept={ACCEPT_ATTR}
                onChange={(e) => { setMenuAnchor(null); pickFile(e.currentTarget); }} />
            </MenuItem>
          )}
      </Menu>

      <AvatarCropDialog
        open={!!cropFile}
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onSave={(blob) => { setAvatar({ kind: "set", blob }); setCropFile(null); }}
      />

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- CharacterModal`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CharacterModal.tsx web/src/components/__tests__/CharacterModal.test.tsx
git commit -m "feat(web): avatar menu and crop staging in CharacterModal"
```

---

## Task 14: `BookScreen` — reconcile avatar after submit

**Files:**
- Modify: `web/src/screens/BookScreen.tsx`
- Modify: `web/src/screens/__tests__/BookScreen.test.tsx`

- [ ] **Step 1: Write/extend the tests**

In `web/src/screens/__tests__/BookScreen.test.tsx`, add `setAvatar` and `deleteAvatar` to the mocked `api` object:

```ts
vi.mock("../../api/client.js", () => ({
  api: {
    getGraph: vi.fn(),
    createCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    deleteBook: vi.fn(),
    savePosition: vi.fn(),
    setAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
    avatarUrl: (id: string, v: string) => `/api/characters/${id}/avatar?v=${v}`,
  },
}));
```

Then append this test:

```tsx
test("removing the avatar in the edit modal calls deleteAvatar with the character id", async () => {
  (api.getGraph as any).mockResolvedValue({
    nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30, avatarUpdatedAt: "2026-06-18T00:00:00.000Z" }],
    edges: [],
  });
  (api.updateCharacter as any).mockResolvedValue({ id: "c1" });
  (api.deleteAvatar as any).mockResolvedValue(undefined);

  renderBookScreen();
  await userEvent.click(await screen.findByRole("button", { name: "tap-c1" }));

  // Open the avatar menu and choose "Удалить" (the avatar removal, not the character).
  await userEvent.click(await screen.findByTestId("avatar-button"));
  await userEvent.click(await screen.findByRole("menuitem", { name: /удалить/i }));

  // Save the modal.
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));

  await waitFor(() => expect(api.deleteAvatar).toHaveBeenCalledWith("c1"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace web -- BookScreen`
Expected: FAIL — `submit` ignores the avatar arg; `deleteAvatar` never called; `CharacterModal` is not yet passed `characterId`/`avatarUpdatedAt`.

- [ ] **Step 3: Implement the BookScreen changes**

In `web/src/screens/BookScreen.tsx`, update the import to include the `AvatarChange` type:

```ts
import { CharacterModal, type AvatarChange } from "../components/CharacterModal.js";
```

Replace `submit` with an avatar-reconciling version:

```ts
  const submit = async (input: CharacterInput, avatar: AvatarChange) => {
    const saved = modal?.mode === "edit" && modal.character
      ? await api.updateCharacter(modal.character.id, input)
      : await api.createCharacter(bookId!, input);
    if (avatar.kind === "set") await api.setAvatar(saved.id, avatar.blob);
    else if (avatar.kind === "remove") await api.deleteAvatar(saved.id);
    setModal(null);
    await refresh();
  };
```

Pass the character id and avatar timestamp into the modal — update the `<CharacterModal .../>` element:

```tsx
        <CharacterModal
          open
          mode={modal.mode}
          others={others}
          initial={initial}
          characterId={modal.character?.id}
          avatarUpdatedAt={modal.character?.avatarUpdatedAt}
          onCancel={() => setModal(null)}
          onSubmit={submit}
          onDelete={modal.mode === "edit" ? remove : undefined}
        />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- BookScreen`
Expected: PASS (the new removal test plus the existing delete/book-delete tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/BookScreen.tsx web/src/screens/__tests__/BookScreen.test.tsx
git commit -m "feat(web): persist avatar changes from the character modal"
```

---

## Task 15: Full verification and manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit/integration suite**

Run: `npm test`
Expected: PASS across both workspaces.

- [ ] **Step 2: Build both packages**

Run: `npm run build`
Expected: web bundle builds and server `tsc` compiles with no type errors (the server `tsc` is the only place `server.ts`/route type errors surface).

- [ ] **Step 3: Manual smoke test (covers the canvas/crop paths jsdom can't)**

Run: `docker compose up --build` and open `http://localhost:3000`.
Verify, in a book with at least one character:
1. Open a character → tap the avatar → **Добавить** → pick a PNG → center/scale in the circle → **Сохранить** → **Сохранить** the character. The custom avatar appears in the modal and as a circular node image on the canvas.
2. Reopen → tap avatar → **Изменить** → pick a different image → save. The node image updates (cache-busted by the new `?v=`).
3. Reopen → tap avatar → **Удалить** → save. The node reverts to the schematic SVG.
4. Try a >15 MB file and a <64 px image → an inline error shows and no crop dialog opens.
5. Pick an animated GIF → it bakes to a static first-frame image (expected; animation not preserved).
6. Delete the character → reload → its avatar is gone (no orphan). Delete the book → its characters' avatars are gone.

- [ ] **Step 4: Commit any fixes surfaced by the build/smoke test**

```bash
git add -A
git commit -m "fix: address issues found during avatar verification"
```

(Skip this commit if steps 1–3 passed clean.)

---

## Self-review notes

- **Spec coverage:** table (Task 1) ✓; PUT/GET/DELETE endpoints (Tasks 2–4) ✓; defense-in-depth validation/byte cap (Task 2) ✓; cascade on character+book delete (Tasks 1, 5) ✓; graph `avatarUpdatedAt` without bytes (Task 6) ✓; `react-easy-crop` dep + type (Task 7) ✓; client `setAvatar`/`deleteAvatar`/`avatarUrl` (Task 8) ✓; canvas endpoint URL (Task 9) ✓; client-side type/size/dimension validation + 512 WebP bake (Task 10) ✓; `Avatar` `src` (Task 11) ✓; circular crop UI (Task 12) ✓; menu Add vs Change/Remove + staging + Cancel-discards (Task 13) ✓; create-and-edit persistence (Task 14) ✓; accepted types incl. SVG/GIF handling (Tasks 10, 13, 15) ✓.
- **Type consistency:** `AvatarChange` defined in Task 13, imported in Task 14; `bakeToWebp`/`loadImage`/`validateFileBasics`/`validateDimensions`/`ACCEPT_ATTR`/`AVATAR_SIZE` defined in Task 10 and used in Tasks 12–13; `api.avatarUrl`/`setAvatar`/`deleteAvatar` defined in Task 8 and used in Tasks 9, 13, 14; `avatarUploadSchema`/`AVATAR_MAX_BYTES` defined in Task 2 schema and imported in the same route file.
- **Out of scope (unchanged):** re-editable crop, GIF animation/vector preservation, server-side image processing, avatar history.
