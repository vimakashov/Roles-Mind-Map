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
