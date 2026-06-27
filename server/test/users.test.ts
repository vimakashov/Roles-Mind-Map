import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { createUser, NicknameTakenError, setPassword, UserNotFoundError, findByNameCI } from "../src/services/users.js";
import { verifyPassword } from "../src/auth.js";

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

test("setPassword changes the hash and the new password verifies", async () => {
  const user = await createUser("erin", "pass1");
  const before = await findByNameCI("erin");
  await setPassword("Erin", "pass2"); // case-insensitive match
  const after = await findByNameCI("erin");
  expect(after!.id).toBe(user.id);
  expect(after!.passwordHash).not.toBe(before!.passwordHash);
  expect(verifyPassword("pass2", after!.passwordHash!)).toBe(true);
  expect(verifyPassword("pass1", after!.passwordHash!)).toBe(false);
});

test("setPassword throws UserNotFoundError for an unknown nickname", async () => {
  await expect(setPassword("nobody", "pass1")).rejects.toBeInstanceOf(UserNotFoundError);
});

test("setPassword rejects an invalid password (too short)", async () => {
  await createUser("frank", "pass1");
  await expect(setPassword("frank", "ab")).rejects.toThrow();
});
