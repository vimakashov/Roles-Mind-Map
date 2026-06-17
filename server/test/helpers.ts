import { execSync } from "node:child_process";
import { prisma } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { ensureDefaultUser } from "../src/defaultUser.js";

let pushed = false;

/** Push schema to the test db once per process. */
export function setupTestDb() {
  if (!pushed) {
    execSync("prisma db push --force-reset --skip-generate", {
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
    });
    pushed = true;
  }
}

/** Delete all rows between tests, preserving the default user. */
export async function resetData() {
  await prisma.characterAvatar.deleteMany();
  await prisma.relationship.deleteMany();
  await prisma.character.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
  await ensureDefaultUser();
}

export async function makeApp() {
  const app = buildApp();
  await app.ready();
  return app;
}

export { prisma };
