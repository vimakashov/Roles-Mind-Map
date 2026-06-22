import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, makeApp } from "./helpers.js";
import { SESSION_COOKIE } from "../src/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { setupTestDb(); app = await makeApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => resetData());

test("register creates an account, sets a session cookie, and auto-authenticates", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { nickname: "tester", password: "pass1" },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({ name: "tester" });
  const setCookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(setCookie).toBeTruthy();

  const me = await app.inject({
    method: "GET", url: "/api/auth/me",
    cookies: { [SESSION_COOKIE]: setCookie!.value },
  });
  expect(me.statusCode).toBe(200);
  expect(me.json()).toMatchObject({ name: "tester" });
});

test("register rejects a duplicate nickname case-insensitively (409)", async () => {
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "Tester", password: "pass1" } });
  const dup = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "tester", password: "pass2" } });
  expect(dup.statusCode).toBe(409);
});

test("register rejects an invalid nickname (400)", async () => {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "ab", password: "pass1" } });
  expect(res.statusCode).toBe(400);
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
