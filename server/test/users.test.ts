import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { createUser, NicknameTakenError } from "../src/services/users.js";

beforeAll(() => { setupTestDb(); });
beforeEach(() => resetData());
afterAll(async () => { await prisma.$disconnect(); });

test("createUser inserts a user with a scrypt-format hash", async () => {
  const u = await createUser("alice", "pass1");
  expect(u).toMatchObject({ name: "alice" });
  const row = await prisma.user.findUnique({ where: { id: u.id } });
  expect(row?.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
});

test("createUser rejects a duplicate nickname case-insensitively", async () => {
  await createUser("Bob", "pass1");
  await expect(createUser("bob", "pass2")).rejects.toBeInstanceOf(NicknameTakenError);
});

test("createUser rejects an invalid (too short) nickname", async () => {
  await expect(createUser("ab", "pass1")).rejects.toThrow();
});
