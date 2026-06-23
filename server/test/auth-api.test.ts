import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, makeApp } from "./helpers.js";
import { SESSION_COOKIE } from "../src/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { setupTestDb(); app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => resetData());

test("the public register route no longer exists (404)", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { nickname: "tester", password: "pass1" },
  });
  expect(res.statusCode).toBe(404);
});

test("login succeeds for the seeded admin and sets a cookie", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { nickname: "synthmadness", password: "6629" },
  });
  expect(res.statusCode).toBe(200);
  expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeTruthy();
});

test("login is case-insensitive on the nickname", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { nickname: "SynthMadness", password: "6629" },
  });
  expect(res.statusCode).toBe(200);
});

test("login fails with a wrong password (401)", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { nickname: "synthmadness", password: "wrong" },
  });
  expect(res.statusCode).toBe(401);
});

test("me returns 401 without a session", async () => {
  const res = await app.inject({ method: "GET", url: "/api/auth/me" });
  expect(res.statusCode).toBe(401);
});
