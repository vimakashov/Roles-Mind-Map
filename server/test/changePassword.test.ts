import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { createUser, findByNameCI } from "../src/services/users.js";
import { changePassword } from "../src/scripts/changePassword.js";

beforeAll(() => { setupTestDb(); });
beforeEach(() => resetData());
afterAll(async () => { await prisma.$disconnect(); });

test("changePassword returns code 0 and updates the hash", async () => {
  await createUser("grace", "pass1");
  const before = await findByNameCI("grace");
  const r = await changePassword({ username: "grace", password: "pass2" } as NodeJS.ProcessEnv);
  expect(r.code).toBe(0);
  const after = await findByNameCI("grace");
  expect(after!.passwordHash).not.toBe(before!.passwordHash);
});

test("changePassword returns code 1 when env vars are missing", async () => {
  const r = await changePassword({} as NodeJS.ProcessEnv);
  expect(r.code).toBe(1);
});

test("changePassword returns code 2 for a nonexistent user (case-insensitive miss)", async () => {
  await createUser("heidi", "pass1");
  const r = await changePassword({ username: "nobody", password: "pass2" } as NodeJS.ProcessEnv);
  expect(r.code).toBe(2);
  expect(r.out).toBe("Пользователя с указанным username не существует");
});

test("changePassword returns code 3 for an invalid password and leaves the hash unchanged", async () => {
  await createUser("ivan", "pass1");
  const before = await findByNameCI("ivan");
  const r = await changePassword({ username: "ivan", password: "ab" } as NodeJS.ProcessEnv);
  expect(r.code).toBe(3);
  const after = await findByNameCI("ivan");
  expect(after!.passwordHash).toBe(before!.passwordHash);
});
