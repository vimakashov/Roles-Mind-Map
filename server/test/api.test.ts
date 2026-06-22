import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, makeApp, prisma } from "./helpers.js";
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
      relations: [{ otherId: petya.id, role: "сын", color: null }],
    },
  });
  expect(vasyaRes.statusCode).toBe(201);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(1);
});

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

test("updates character relations via reconciliation", async () => {
  const book = await createBook();
  const t = (n: string) => app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: n, lastName: "X", relations: [] },
  }).then((r) => r.json());
  const a = await t("A"); const b = await t("B");
  const v = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "V", lastName: "X", relations: [{ otherId: a.id, role: "друг", color: null }] },
  })).json();

  await app.inject({
    method: "PATCH", url: `/api/characters/${v.id}`,
    payload: { gender: "male", firstName: "V", lastName: "X", relations: [{ otherId: b.id, role: "друг", color: null }] },
  });

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.edges).toHaveLength(1);
  const e = graph.edges[0];
  expect([e.sourceId, e.targetId]).toContain(b.id);
  expect([e.sourceId, e.targetId]).toContain(v.id);
});

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

test("deletes character and cascades its edges", async () => {
  const book = await createBook();
  const a = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "male", firstName: "A", lastName: "X", relations: [] } })).json();
  const b = (await app.inject({ method: "POST", url: "/api/characters", payload: { bookId: book.id, gender: "female", firstName: "B", lastName: "X", relations: [{ otherId: a.id, role: "жена", color: null }] } })).json();

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

test("accepts 60-char book title on create", async () => {
  const title60 = "A".repeat(60);
  const res = await app.inject({ method: "POST", url: "/api/books", payload: { title: title60 } });
  expect(res.statusCode).toBe(201);
  expect(res.json().title).toBe(title60);
});

test("rejects 61-char book title on create", async () => {
  const title61 = "A".repeat(61);
  const res = await app.inject({ method: "POST", url: "/api/books", payload: { title: title61 } });
  expect(res.statusCode).toBe(400);
});

test("accepts 60-char book title on rename", async () => {
  const book = await createBook();
  const title60 = "B".repeat(60);
  const res = await app.inject({ method: "PATCH", url: `/api/books/${book.id}`, payload: { title: title60 } });
  expect(res.statusCode).toBe(200);
  expect(res.json().title).toBe(title60);
});

test("rejects 61-char book title on rename", async () => {
  const book = await createBook();
  const title61 = "B".repeat(61);
  const res = await app.inject({ method: "PATCH", url: `/api/books/${book.id}`, payload: { title: title61 } });
  expect(res.statusCode).toBe(400);
});

test("returns 404 for non-existent ids on update and delete", async () => {
  const nonExistentId = 999999;
  const patch = await app.inject({
    method: "PATCH", url: `/api/books/${nonExistentId}`,
    payload: { title: "Ghost Book" },
  });
  expect(patch.statusCode).toBe(404);

  const del = await app.inject({ method: "DELETE", url: `/api/characters/${nonExistentId}` });
  expect(del.statusCode).toBe(404);
});

test("persists the deceased flag on create and exposes it in the graph", async () => {
  const book = await createBook();
  const res = await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "Boris", lastName: "B", deceased: true, relations: [] },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().deceased).toBe(true);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes[0].deceased).toBe(true);
});

test("defaults deceased to false when omitted and toggles via PATCH", async () => {
  const book = await createBook();
  const c = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "Ivan", lastName: "I", relations: [] },
  })).json();
  expect(c.deceased).toBe(false);

  const patched = await app.inject({
    method: "PATCH", url: `/api/characters/${c.id}`,
    payload: { gender: "male", firstName: "Ivan", lastName: "I", deceased: true, relations: [] },
  });
  expect(patched.statusCode).toBe(200);
  expect(patched.json().deceased).toBe(true);
});

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
