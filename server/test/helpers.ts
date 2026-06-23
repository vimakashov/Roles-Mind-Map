import { execSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { ensureAdminUser } from "../src/adminUser.js";
import { SESSION_COOKIE } from "../src/auth.js";
import { createUser } from "../src/services/users.js";

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
  await prisma.comment.deleteMany();
  await prisma.character.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
  await ensureAdminUser();
}

export async function makeApp() {
  const app = buildApp();
  await app.ready();
  return app;
}

/** Create a user, log them in, and return a `cookie` header string carrying their session. */
export async function signIn(app: FastifyInstance, nickname = "tester", password = "pass1"): Promise<string> {
  await createUser(nickname, password);
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname, password } });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error(`signIn failed: ${res.statusCode} ${res.body}`);
  return `${SESSION_COOKIE}=${c.value}`;
}

export { prisma };
