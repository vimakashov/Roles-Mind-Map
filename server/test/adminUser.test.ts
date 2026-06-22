import { afterAll, beforeEach, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { prisma } from "../src/db.js";
import { ensureAdminUser, ADMIN_NICKNAME, LEGACY_USER_ID } from "../src/adminUser.js";
import { verifyPassword } from "../src/auth.js";

beforeEach(async () => {
  execSync("prisma db push --force-reset --skip-generate", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
});
afterAll(async () => { await prisma.$disconnect(); });

test("upgrades the legacy local user (with its books) into admin", async () => {
  await prisma.user.create({ data: { id: LEGACY_USER_ID, name: "Local user" } });
  await prisma.book.create({ data: { userId: LEGACY_USER_ID, title: "Existing book" } });

  await ensureAdminUser();

  const admin = await prisma.user.findUnique({ where: { id: LEGACY_USER_ID } });
  expect(admin?.name).toBe(ADMIN_NICKNAME);
  expect(verifyPassword("6629", admin!.passwordHash!)).toBe(true);
  const books = await prisma.book.findMany({ where: { userId: LEGACY_USER_ID } });
  expect(books).toHaveLength(1);
});

test("seeds admin on a fresh empty DB", async () => {
  await ensureAdminUser();
  const admin = await prisma.user.findFirst({ where: { name: ADMIN_NICKNAME } });
  expect(admin).not.toBeNull();
  expect(verifyPassword("6629", admin!.passwordHash!)).toBe(true);
});

test("is idempotent and does not reset an existing admin password", async () => {
  await ensureAdminUser();
  const before = (await prisma.user.findFirst({ where: { name: ADMIN_NICKNAME } }))!;
  await ensureAdminUser();
  const after = (await prisma.user.findFirst({ where: { name: ADMIN_NICKNAME } }))!;
  expect(after.passwordHash).toBe(before.passwordHash);
});
