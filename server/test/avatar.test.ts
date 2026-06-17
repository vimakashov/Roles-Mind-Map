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
