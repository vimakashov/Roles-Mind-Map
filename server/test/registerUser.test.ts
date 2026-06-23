import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { register } from "../src/scripts/registerUser.js";

beforeAll(() => { setupTestDb(); });
beforeEach(() => resetData());
afterAll(async () => { await prisma.$disconnect(); });

test("register creates a user and returns code 0", async () => {
  const r = await register({ username: "carol", password: "pass1" } as NodeJS.ProcessEnv);
  expect(r.code).toBe(0);
  expect(await prisma.user.findFirst({ where: { name: "carol" } })).toBeTruthy();
});

test("register returns code 1 when env vars are missing", async () => {
  const r = await register({} as NodeJS.ProcessEnv);
  expect(r.code).toBe(1);
});

test("register returns code 2 for a duplicate nickname (case-insensitive)", async () => {
  await register({ username: "dave", password: "pass1" } as NodeJS.ProcessEnv);
  const r = await register({ username: "Dave", password: "pass2" } as NodeJS.ProcessEnv);
  expect(r.code).toBe(2);
});

test("register returns code 3 for invalid input", async () => {
  const r = await register({ username: "ab", password: "pass1" } as NodeJS.ProcessEnv);
  expect(r.code).toBe(3);
});
