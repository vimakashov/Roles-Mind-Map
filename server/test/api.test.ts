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
