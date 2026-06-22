import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, makeApp, signIn } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { setupTestDb(); app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => resetData());

test("a user only lists their own books", async () => {
  const a = await signIn(app, "usera", "pass1");
  const b = await signIn(app, "userb", "pass1");
  await app.inject({ method: "POST", url: "/api/books", headers: { cookie: a }, payload: { title: "A book" } });

  const bList = (await app.inject({ method: "GET", url: "/api/books", headers: { cookie: b } })).json();
  expect(bList).toHaveLength(0);
  const aList = (await app.inject({ method: "GET", url: "/api/books", headers: { cookie: a } })).json();
  expect(aList).toHaveLength(1);
});

test("a user cannot read another user's book graph (404)", async () => {
  const a = await signIn(app, "usera", "pass1");
  const b = await signIn(app, "userb", "pass1");
  const book = (await app.inject({ method: "POST", url: "/api/books", headers: { cookie: a }, payload: { title: "A book" } })).json();

  const res = await app.inject({ method: "GET", url: `/api/books/${book.id}/graph`, headers: { cookie: b } });
  expect(res.statusCode).toBe(404);
});

test("a request with no session is rejected (401)", async () => {
  const res = await app.inject({ method: "GET", url: "/api/books" });
  expect(res.statusCode).toBe(401);
});

test("a user cannot delete another user's book (404)", async () => {
  const a = await signIn(app, "usera", "pass1");
  const b = await signIn(app, "userb", "pass1");
  const book = (await app.inject({ method: "POST", url: "/api/books", headers: { cookie: a }, payload: { title: "A book" } })).json();

  const res = await app.inject({ method: "DELETE", url: `/api/books/${book.id}`, headers: { cookie: b } });
  expect(res.statusCode).toBe(404);
  const stillThere = (await app.inject({ method: "GET", url: "/api/books", headers: { cookie: a } })).json();
  expect(stillThere).toHaveLength(1);
});
