# Simple Auth (nickname + password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user accounts (nickname + password) with long-lived cookie sessions, gate the SPA behind an auth screen, scope all data to the logged-in user, and migrate existing data onto a seeded `synthmadness / 6629` admin account.

**Architecture:** Fastify gains a signed `httpOnly` cookie session (`@fastify/cookie`) holding the userId; passwords are hashed with Node's built-in `crypto.scrypt`. A `preHandler` resolves `req.user` and rejects unauthenticated `/api/*` (except `/api/auth/*`). All book/character/relationship queries scope to `req.user.id` with ownership checks. The React SPA wraps its router in an `AuthGate` that calls `/api/auth/me` and shows an `AuthScreen` (register/login modes + forgot-password modal) when anonymous.

**Tech Stack:** Fastify 4, Prisma 5, SQLite, `@fastify/cookie`, `node:crypto`, zod (server + web), React 18, MUI, react-router, Vitest (server: node env; web: jsdom).

## Global Constraints

- **Pure-JS server, no native deps.** Hash with `node:crypto` `scrypt` only. NO bcrypt/argon2.
- **Seed account:** login `synthmadness`, password `6629`.
- **No logout** anywhere (UI or route).
- **Nickname:** trim, 3–20 chars, `/^[A-Za-zА-Яа-яЁё0-9]+$/`. Uniqueness + login lookup are **case-insensitive** via raw `LOWER(name) = LOWER(:input)`; stored as entered.
- **Password:** 3–30 chars, `/^[\x21-\x7E]+$/` (printable non-space ASCII).
- **Cookie:** name `rmm_session`, value = userId, **signed**, `httpOnly`, `sameSite: "lax"`, `path: "/"`, `maxAge = 60*60*24*365*10` (10 years).
- **`User.passwordHash` is nullable** (`String?`) so `db push` adds the column non-destructively; filled on boot by `ensureAdminUser`.
- File-nav/edit per `CLAUDE.md` Tooling rules (Serena MCP). Run the **full** `npm run test --workspace server` before declaring server work done (per CLAUDE.md gotcha). Run `npx tsc --noEmit -p web/tsconfig.json` after large web edits.

---

## Task 1: Password hashing + session secret (`server/src/auth.ts`)

Pure, framework-free helpers. No Fastify/Prisma yet — fully unit-testable.

**Files:**
- Create: `server/src/auth.ts`
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): string` → `"<saltHex>:<hashHex>"`
  - `verifyPassword(plain: string, stored: string): boolean` (constant-time; `false` on malformed `stored`)
  - `getSessionSecret(): string`
  - `SESSION_COOKIE = "rmm_session"`, `SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 10`

- [ ] **Step 1: Write the failing test**

Create `server/test/auth.test.ts`:

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";

test("hashPassword produces a salt:hash string that verifies", () => {
  const stored = hashPassword("6629");
  expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  expect(verifyPassword("6629", stored)).toBe(true);
});

test("verifyPassword rejects the wrong password", () => {
  const stored = hashPassword("6629");
  expect(verifyPassword("6628", stored)).toBe(false);
});

test("verifyPassword returns false for malformed stored value", () => {
  expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
});

test("two hashes of the same password differ (random salt)", () => {
  expect(hashPassword("abc")).not.toBe(hashPassword("abc"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server -- auth`
Expected: FAIL — `Cannot find module '../src/auth.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/auth.ts`:

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SESSION_COOKIE = "rmm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 10; // ~10 years, in seconds

const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(plain, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Resolve the cookie-signing secret: env var, else a generated secret persisted
 *  next to the SQLite DB so it survives restarts (cookies stay valid). */
export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const dbFile = url.startsWith("file:") ? url.slice("file:".length) : "./dev.db";
  const secretPath = path.join(path.dirname(dbFile), "session-secret");

  if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();
  const generated = randomBytes(32).toString("hex");
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace server -- auth`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth.ts server/test/auth.test.ts
git commit -m "feat(server): scrypt password hashing + session secret helpers"
```

---

## Task 2: Schema change + admin migration (`ensureAdminUser`)

Add `passwordHash`/`@unique` to `User`, replace `ensureDefaultUser` with `ensureAdminUser`, wire it into boot and test helpers.

**Files:**
- Modify: `server/prisma/schema.prisma:10-15` (User model)
- Create: `server/src/adminUser.ts`
- Delete: `server/src/defaultUser.ts` (replaced)
- Modify: `server/src/server.ts:6,22` (import + call)
- Modify: `server/src/routes/books.ts:3` (import path only; rewritten in Task 4)
- Modify: `server/test/helpers.ts:4,27` (import + `resetData`)
- Modify import path only (`../src/defaultUser.js` → `../src/adminUser.js`): `server/test/normalize.test.ts:4`, `server/test/graph.test.ts:4`, `server/test/comments.test.ts:5`, `server/test/relationships.test.ts:5`
- Test: `server/test/adminUser.test.ts`

**Interfaces:**
- Consumes: `hashPassword` (Task 1).
- Produces:
  - `ADMIN_NICKNAME = "synthmadness"`, `ADMIN_PASSWORD = "6629"`, `LEGACY_USER_ID = "default-user"`
  - `DEFAULT_USER_ID = LEGACY_USER_ID` (re-export so service-direct tests creating books with a fixed owner id keep working; the id is preserved by `ensureAdminUser`)
  - `ensureAdminUser(): Promise<void>`

- [ ] **Step 1: Update the Prisma schema**

In `server/prisma/schema.prisma`, replace the `User` model (lines 10–15) with:

```prisma
model User {
  id           String   @id @default(cuid())
  name         String   @unique
  passwordHash String?
  createdAt    DateTime @default(now())
  books        Book[]
}
```

Regenerate the client:

Run: `npm run prisma:generate --workspace server`
Expected: "Generated Prisma Client".

- [ ] **Step 2: Write the failing test**

Create `server/test/adminUser.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace server -- adminUser`
Expected: FAIL — `Cannot find module '../src/adminUser.js'`.

- [ ] **Step 4: Write the implementation**

Create `server/src/adminUser.ts`:

```ts
import { prisma } from "./db.js";
import { hashPassword } from "./auth.js";

export const ADMIN_NICKNAME = "synthmadness";
export const ADMIN_PASSWORD = "6629";
export const LEGACY_USER_ID = "default-user";
/** Back-compat alias: the seeded admin keeps the legacy row id, so service-direct
 *  tests that create books with a fixed owner id keep resolving to a real user. */
export const DEFAULT_USER_ID = LEGACY_USER_ID;

/** Ensure the seeded admin account exists, owning all pre-existing data.
 *  Idempotent: never resets an already-credentialed admin's password.
 *  (No orphan-book reassignment needed: FK `onDelete: Cascade` + Prisma's
 *  enforced foreign keys make books with a missing owner impossible.) */
export async function ensureAdminUser(): Promise<void> {
  const legacy = await prisma.user.findUnique({ where: { id: LEGACY_USER_ID } });

  if (legacy) {
    // Pre-auth local user → upgrade in place so its books stay attached.
    if (!legacy.passwordHash) {
      await prisma.user.update({
        where: { id: LEGACY_USER_ID },
        data: { name: ADMIN_NICKNAME, passwordHash: hashPassword(ADMIN_PASSWORD) },
      });
    }
    return;
  }

  const admin = await prisma.user.findFirst({ where: { name: ADMIN_NICKNAME } });
  if (!admin) {
    await prisma.user.create({
      data: { id: LEGACY_USER_ID, name: ADMIN_NICKNAME, passwordHash: hashPassword(ADMIN_PASSWORD) },
    });
  }
}
```

Delete `server/src/defaultUser.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace server -- adminUser`
Expected: PASS (4 tests).

- [ ] **Step 6: Repoint every `defaultUser.js` import to `adminUser.js`**

`server/src/defaultUser.ts` is being deleted, so update the 7 importers (the constant value/usage is unchanged — only the module path moves, and `ensureDefaultUser` → `ensureAdminUser`):

- `server/src/server.ts`: `import { ensureDefaultUser } from "./defaultUser.js";` → `import { ensureAdminUser } from "./adminUser.js";`; call `await ensureDefaultUser();` → `await ensureAdminUser();`.
- `server/test/helpers.ts`: `import { ensureDefaultUser } from "../src/defaultUser.js";` → `import { ensureAdminUser } from "../src/adminUser.js";`; in `resetData()` `await ensureDefaultUser();` → `await ensureAdminUser();`.
- `server/src/routes/books.ts`: `import { DEFAULT_USER_ID } from "../defaultUser.js";` → `import { DEFAULT_USER_ID } from "../adminUser.js";` (still compiles; rewritten in Task 4).
- `server/test/normalize.test.ts`, `server/test/graph.test.ts`, `server/test/comments.test.ts`, `server/test/relationships.test.ts`: change `from "../src/defaultUser.js"` → `from "../src/adminUser.js"` (each imports `DEFAULT_USER_ID`; usage unchanged — those tests create books owned by the preserved `default-user` id, which is now the admin).

- [ ] **Step 7: Verify the whole suite still passes**

Run: `npm run test --workspace server`
Expected: **ALL** suites PASS. No auth gate is installed yet (that arrives in Task 3) and `books.ts` still uses `DEFAULT_USER_ID`, so existing API tests are unaffected. Confirm there are **no** module-not-found errors for `defaultUser.js` (all importers repointed in Step 6).

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/src/adminUser.ts server/src/server.ts server/src/routes/books.ts server/test/helpers.ts server/test/adminUser.test.ts server/test/normalize.test.ts server/test/graph.test.ts server/test/comments.test.ts server/test/relationships.test.ts
git rm server/src/defaultUser.ts
git commit -m "feat(server): User credentials schema + ensureAdminUser migration"
```

---

## Task 3: Cookie sessions + auth routes (register/login/me)

Register `@fastify/cookie`, add the auth `preHandler`, and the three auth endpoints. Scoping of existing routes happens in Task 4 — here the gate is installed and auth routes work.

**Files:**
- Modify: `server/package.json` (add `@fastify/cookie`)
- Modify: `server/vitest.config.ts` (add a stable `SESSION_SECRET` to the test env)
- Modify: `server/src/schemas.ts` (add nickname/password/auth schemas)
- Create: `server/src/routes/auth.ts`
- Modify: `server/src/app.ts` (register cookie plugin + preHandler + auth routes)
- Test: `server/test/auth-api.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `SESSION_COOKIE`, `SESSION_MAX_AGE`, `getSessionSecret` (Task 1); `prisma`.
- Produces:
  - zod: `registerSchema` / `loginSchema` = `{ nickname, password }`
  - `authRoutes(app)` registering `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
  - `req.user?: { id: string; name: string }` on every request (Fastify module augmentation)
  - Behaviour relied on by Task 4: the preHandler 401s any `/api/*` request (except `/api/auth/*`) that has no valid session.

- [ ] **Step 1: Add the dependency**

Run: `npm install @fastify/cookie@^9 --workspace server`
Expected: `@fastify/cookie` added to `server/package.json` dependencies. (v9 is the Fastify 4-compatible line.)

Then add a stable signing secret to the test env so cookies sign deterministically and tests never write a `session-secret` file. In `server/vitest.config.ts`, add to the `test.env` object (alongside `DATABASE_URL`):

```ts
      SESSION_SECRET: "test-secret-do-not-use-in-prod",
```

- [ ] **Step 2: Add auth schemas**

In `server/src/schemas.ts`, add after the existing `hexColor` line:

```ts
export const nicknameSchema = z
  .string()
  .trim()
  .min(3, "Минимум 3 символа")
  .max(20, "Максимум 20 символов")
  .regex(/^[A-Za-zА-Яа-яЁё0-9]+$/, "Только буквы и цифры");

export const passwordSchema = z
  .string()
  .min(3, "Минимум 3 символа")
  .max(30, "Максимум 30 символов")
  .regex(/^[\x21-\x7E]+$/, "Недопустимые символы");

export const registerSchema = z.object({ nickname: nicknameSchema, password: passwordSchema });
export const loginSchema = z.object({ nickname: nicknameSchema, password: passwordSchema });
```

- [ ] **Step 3: Write the failing test**

Create `server/test/auth-api.test.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace server -- auth-api`
Expected: FAIL — register route 404 (routes not registered yet).

- [ ] **Step 5: Implement the auth routes**

Create `server/src/routes/auth.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword, SESSION_COOKIE, SESSION_MAX_AGE } from "../auth.js";
import { registerSchema, loginSchema } from "../schemas.js";

function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(SESSION_COOKIE, userId, {
    signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
  });
}

/** Case-insensitive lookup (Prisma SQLite has no `mode: "insensitive"`). */
async function findByNameCI(nickname: string) {
  const rows = await prisma.$queryRaw<{ id: string; name: string; passwordHash: string | null }[]>(
    Prisma.sql`SELECT id, name, passwordHash FROM User WHERE LOWER(name) = LOWER(${nickname}) LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { nickname, password } = parsed.data;

    if (await findByNameCI(nickname)) return reply.code(409).send({ error: "nickname taken" });

    const user = await prisma.user.create({
      data: { name: nickname, passwordHash: hashPassword(password) },
      select: { id: true, name: true },
    });
    setSession(reply, user.id);
    return reply.code(201).send(user);
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { nickname, password } = parsed.data;

    const row = await findByNameCI(nickname);
    if (!row || !row.passwordHash || !verifyPassword(password, row.passwordHash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    setSession(reply, row.id);
    return reply.send({ id: row.id, name: row.name });
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthorized" });
    return req.user;
  });
}
```

- [ ] **Step 6: Register the cookie plugin + preHandler + routes**

Replace the body of `server/src/app.ts` with:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { prisma } from "./db.js";
import { getSessionSecret, SESSION_COOKIE } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { bookRoutes } from "./routes/books.js";
import { characterRoutes } from "./routes/characters.js";
import { relationshipRoutes } from "./routes/relationships.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; name: string };
  }
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(fastifyCookie, { secret: getSessionSecret() });

  // Resolve req.user from the signed session cookie, and gate /api/* (except /api/auth/*).
  app.addHook("preHandler", async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        const user = await prisma.user.findUnique({
          where: { id: unsigned.value },
          select: { id: true, name: true },
        });
        if (user) req.user = user;
      }
    }
    const isApi = req.url.startsWith("/api/");
    const isAuth = req.url.startsWith("/api/auth/");
    if (isApi && !isAuth && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.register(authRoutes);
  app.register(bookRoutes);
  app.register(characterRoutes);
  app.register(relationshipRoutes);
  app.setErrorHandler((err, _req, reply) => {
    if ((err as { code?: string }).code === "P2025") {
      return reply.code(404).send({ error: "not found" });
    }
    reply.send(err);
  });
  return app;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test --workspace server -- auth-api`
Expected: PASS (7 tests).

> EXPECTED: a full `npm run test --workspace server` now FAILS `api.test.ts` and `avatar.test.ts` with 401s — the gate is installed but those tests don't send a cookie yet. Task 4 (Step 9) authenticates them. Do not "fix" them here.

- [ ] **Step 8: Commit**

```bash
git add server/package.json package-lock.json server/vitest.config.ts server/src/schemas.ts server/src/routes/auth.ts server/src/app.ts server/test/auth-api.test.ts
git commit -m "feat(server): cookie sessions + register/login/me routes"
```

---

## Task 4: Per-user scoping + ownership + authenticate existing tests

Scope every data route to `req.user.id`, reject cross-user access, and update the existing server tests to send a session cookie.

**Files:**
- Create: `server/src/ownership.ts`
- Modify: `server/src/routes/books.ts` (all handlers)
- Modify: `server/src/routes/characters.ts` (ownership on each `:id`/`bookId` op)
- Modify: `server/src/routes/relationships.ts` (ownership on each `:id` op)
- Modify: `server/test/helpers.ts` (add `signIn`)
- Modify: `server/test/api.test.ts`, `server/test/avatar.test.ts` (authenticate `/api` injects — these are the only two test files that use `app.inject`; the others are service-direct and already handled in Task 2)
- Test: `server/test/scoping.test.ts`

**Interfaces:**
- Consumes: `req.user` (Task 3).
- Produces (`server/src/ownership.ts`):
  - `bookOwnedBy(userId: string, bookId: string): Promise<boolean>`
  - `characterBookOwnedBy(userId: string, characterId: string): Promise<boolean>`
  - `relationshipOwnedBy(userId: string, relationshipId: string): Promise<boolean>`
- Produces (`server/test/helpers.ts`): `signIn(app, nickname?, password?): Promise<string>` returning a `cookie` header string.

- [ ] **Step 1: Write the failing scoping test**

Create `server/test/scoping.test.ts`:

```ts
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
```

- [ ] **Step 2: Add `signIn` to test helpers**

In `server/test/helpers.ts`, add:

```ts
import { SESSION_COOKIE } from "../src/auth.js";

/** Register a user and return a `cookie` header string carrying their session. */
export async function signIn(app: FastifyInstance, nickname = "tester", password = "pass1"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname, password } });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error(`signIn failed: ${res.statusCode} ${res.body}`);
  return `${SESSION_COOKIE}=${c.value}`;
}
```

Add the `FastifyInstance` type import if not present: `import type { FastifyInstance } from "fastify";`.

- [ ] **Step 3: Run the scoping test to verify it fails**

Run: `npm run test --workspace server -- scoping`
Expected: FAIL — books route still uses `DEFAULT_USER_ID`, so `bList` has 1 and cross-user reads succeed.

- [ ] **Step 4: Create ownership helpers**

Create `server/src/ownership.ts`:

```ts
import { prisma } from "./db.js";

export async function bookOwnedBy(userId: string, bookId: string): Promise<boolean> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { userId: true } });
  return !!book && book.userId === userId;
}

export async function characterBookOwnedBy(userId: string, characterId: string): Promise<boolean> {
  const c = await prisma.character.findUnique({
    where: { id: characterId },
    select: { book: { select: { userId: true } } },
  });
  return !!c && c.book.userId === userId;
}

export async function relationshipOwnedBy(userId: string, relationshipId: string): Promise<boolean> {
  const r = await prisma.relationship.findUnique({
    where: { id: relationshipId },
    select: { book: { select: { userId: true } } },
  });
  return !!r && r.book.userId === userId;
}
```

- [ ] **Step 5: Rewrite the books route**

Replace `server/src/routes/books.ts` with (drop the `DEFAULT_USER_ID` import entirely — the route now uses `req.user!.id`; keep the `DEFAULT_USER_ID` export in `adminUser.ts`, the service-direct tests still use it):

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { bookCreateSchema, bookUpdateSchema } from "../schemas.js";
import { bookOwnedBy } from "../ownership.js";

export async function bookRoutes(app: FastifyInstance) {
  app.get("/api/books", async (req) =>
    prisma.book.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  );

  app.post("/api/books", async (req, reply) => {
    const parsed = bookCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.user!.id;
    const count = await prisma.book.count({ where: { userId } });
    const book = await prisma.book.create({
      data: { userId, title: parsed.data.title, sortOrder: count },
    });
    return reply.code(201).send(book);
  });

  app.patch<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    const parsed = bookUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await bookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    const book = await prisma.book.update({ where: { id: req.params.id }, data: parsed.data });
    return book;
  });

  app.delete<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    if (!(await bookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    await prisma.book.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/books/:id/graph", async (req, reply) => {
    if (!(await bookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    const { getBookGraph } = await import("../services/graph.js");
    return getBookGraph(req.params.id);
  });
}
```

(Do **not** remove the `DEFAULT_USER_ID` export from `adminUser.ts` — the service-direct test suites still import it.)

- [ ] **Step 6: Add ownership checks to the characters route**

In `server/src/routes/characters.ts`:

Add the import at the top:
```ts
import { bookOwnedBy, characterBookOwnedBy } from "../ownership.js";
```

In `POST /api/characters`, after the `safeParse` success check and before the `$transaction`, add:
```ts
    if (!(await bookOwnedBy(req.user!.id, parsed.data.bookId))) return reply.code(404).send({ error: "not found" });
```

In each of `PATCH /api/characters/:id`, `PATCH /api/characters/:id/pos`, `PUT /api/characters/:id/avatar`, `GET /api/characters/:id/avatar`, `DELETE /api/characters/:id/avatar`, and `DELETE /api/characters/:id`, add as the first line of the handler:
```ts
    if (!(await characterBookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
```
(For the `PUT` avatar handler, place it after the `safeParse`/byte-cap checks and replace the existing `findUnique`→404 block, since ownership now also proves existence.)

- [ ] **Step 7: Add ownership checks to the relationships route**

Replace `server/src/routes/relationships.ts` with:

```ts
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { relationUpdateSchema } from "../schemas.js";
import { relationshipOwnedBy } from "../ownership.js";

export async function relationshipRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string } }>("/api/relationships/:id", async (req, reply) => {
    const parsed = relationUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await relationshipOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    return prisma.relationship.update({ where: { id: req.params.id }, data: parsed.data });
  });

  app.delete<{ Params: { id: string } }>("/api/relationships/:id", async (req, reply) => {
    if (!(await relationshipOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    await prisma.relationship.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 8: Run the scoping test to verify it passes**

Run: `npm run test --workspace server -- scoping`
Expected: PASS (4 tests).

- [ ] **Step 9: Authenticate `api.test.ts` and `avatar.test.ts`**

These two files (the only ones using `app.inject`) now hit the gate. Apply this mechanical transform to **each**:

1. Add `signIn` to the `helpers` import: e.g. `import { setupTestDb, resetData, makeApp, signIn } from "./helpers.js";` (keep whatever else each file already imports).
2. Declare a module-level `let cookie: string;` next to the existing `let app`.
3. Change the `beforeEach` from `beforeEach(() => resetData());` to:
   ```ts
   beforeEach(async () => { await resetData(); cookie = await signIn(app); });
   ```
4. Add a local authenticated inject helper near the top (below the `let` declarations):
   ```ts
   const inject = (opts: Parameters<FastifyInstance["inject"]>[0]) =>
     app.inject({ ...opts, headers: { ...(opts as { headers?: Record<string, string> }).headers, cookie } });
   ```
   `FastifyInstance` is already imported in both files.
5. Replace every `app.inject(` call **that targets a `/api/books|characters|relationships` URL** with `inject(`. Leave `await app.close()` (in `afterAll`) calling `app` directly. (Neither file calls `/api/auth`, so every `app.inject` here is a data-route call → all become `inject`.)

The service-direct suites (`comments`, `graph`, `relationships`, `normalize`) need **no** change here — they were repointed in Task 2 and create books under the preserved `default-user` (admin) id without touching the HTTP gate.

- [ ] **Step 10: Run the full server suite**

Run: `npm run test --workspace server`
Expected: ALL suites PASS. Per CLAUDE.md, the full server run (not a focused one) is required before declaring server work done.

- [ ] **Step 11: Verify the server build compiles**

Run: `npm run build --workspace server`
Expected: `tsc` exits 0 (no leftover `defaultUser.js` / `DEFAULT_USER_ID` references; `req.user!` typed via the module augmentation in `app.ts`).

- [ ] **Step 12: Commit**

```bash
git add server/src/ownership.ts server/src/routes/ server/test/
git commit -m "feat(server): scope all data routes to the authenticated user"
```

---

## Task 5: Web API client + types + validation

Add `register`/`login`/`me` to the client, an `AuthUser` type, and shared nickname/password validation.

**Files:**
- Modify: `web/src/types.ts` (add `AuthUser`)
- Modify: `web/src/api/client.ts` (add `register`, `login`, `me`)
- Modify: `web/src/lib/validation.ts` (add `nicknameField`, `passwordField`)
- Test: `web/src/lib/__tests__/authValidation.test.ts`

**Interfaces:**
- Produces:
  - `interface AuthUser { id: string; name: string }`
  - `api.register(nickname, password): Promise<AuthUser>`
  - `api.login(nickname, password): Promise<AuthUser>`
  - `api.me(): Promise<AuthUser>` (rejects on 401)
  - zod `nicknameField`, `passwordField` (web mirror of the server rules)

- [ ] **Step 1: Write the failing validation test**

Create `web/src/lib/__tests__/authValidation.test.ts`:

```ts
import { expect, test } from "vitest";
import { nicknameField, passwordField } from "../validation.js";

test("nickname accepts RU/EN letters and digits, 3-20 chars", () => {
  expect(nicknameField.safeParse("Маша123").success).toBe(true);
  expect(nicknameField.safeParse("ab").success).toBe(false);      // too short
  expect(nicknameField.safeParse("bad name").success).toBe(false); // space
  expect(nicknameField.safeParse("a".repeat(21)).success).toBe(false);
});

test("password accepts 3-30 printable ASCII, rejects spaces", () => {
  expect(passwordField.safeParse("6629").success).toBe(true);
  expect(passwordField.safeParse("p@ss!").success).toBe(true);
  expect(passwordField.safeParse("ab").success).toBe(false);       // too short
  expect(passwordField.safeParse("has space").success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- authValidation`
Expected: FAIL — `nicknameField` is not exported.

- [ ] **Step 3: Add the validation fields**

In `web/src/lib/validation.ts`, add at the end:

```ts
export const nicknameField = z
  .string()
  .trim()
  .min(3, "Минимум 3 символа")
  .max(20, "Максимум 20 символов")
  .regex(/^[A-Za-zА-Яа-яЁё0-9]+$/, "Только буквы и цифры");

export const passwordField = z
  .string()
  .min(3, "Минимум 3 символа")
  .max(30, "Максимум 30 символов")
  .regex(/^[\x21-\x7E]+$/, "Недопустимые символы");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- authValidation`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the `AuthUser` type**

In `web/src/types.ts`, add:

```ts
export interface AuthUser {
  id: string;
  name: string;
}
```

- [ ] **Step 6: Add the client methods**

In `web/src/api/client.ts`, add `AuthUser` to the type import from `../types.js`, and add these entries to the `api` object:

```ts
  register: (nickname: string, password: string) =>
    req<AuthUser>("/api/auth/register", { method: "POST", body: JSON.stringify({ nickname, password }) }),
  login: (nickname: string, password: string) =>
    req<AuthUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ nickname, password }) }),
  me: () => req<AuthUser>("/api/auth/me"),
```

(The existing `req` helper already throws on non-2xx, so a 401 from `me()` rejects — `AuthGate` catches it.)

- [ ] **Step 7: Verify build + tests**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm run test --workspace web -- authValidation`
Expected: tsc exits 0; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/types.ts web/src/api/client.ts web/src/lib/validation.ts web/src/lib/__tests__/authValidation.test.ts
git commit -m "feat(web): auth API client, AuthUser type, nickname/password validation"
```

---

## Task 6: `AuthScreen` component

Self-contained screen: two persistent fields, register/login mode toggle, inline errors, and the forgot-password modal.

**Files:**
- Create: `web/src/screens/AuthScreen.tsx`
- Test: `web/src/screens/__tests__/AuthScreen.test.tsx`

**Interfaces:**
- Consumes: `api.register`, `api.login` (Task 5); `nicknameField`, `passwordField` (Task 5); `useBackClose`, `__resetBackStack` (existing).
- Produces: `function AuthScreen({ onAuthenticated }: { onAuthenticated: (u: AuthUser) => void })`.

- [ ] **Step 1: Write the failing test**

Create `web/src/screens/__tests__/AuthScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";
import { AuthScreen } from "../AuthScreen.js";
import { __resetBackStack } from "../../lib/backStack.js";
import { api } from "../../api/client.js";

beforeEach(() => __resetBackStack());

test("register mode is the default and shows both register-mode buttons", () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  expect(screen.getByRole("button", { name: /^зарегистрироваться$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /уже есть аккаунт/i })).toBeInTheDocument();
});

test("«Уже есть аккаунт» switches to login mode keeping field values", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.click(screen.getByRole("button", { name: /уже есть аккаунт/i }));
  expect(screen.getByRole("button", { name: /^войти$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /забыли пароль/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/логин/i)).toHaveValue("tester");
});

test("«Забыли пароль?» opens the contact modal with the site link", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /уже есть аккаунт/i }));
  await userEvent.click(screen.getByRole("button", { name: /забыли пароль/i }));
  expect(screen.getByText(/обратитесь к администратору сайта/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /mkv\.qa/i })).toHaveAttribute("href", "https://mkv.qa/");
});

test("shows a validation error for a too-short nickname", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "ab");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^зарегистрироваться$/i }));
  expect(await screen.findByText(/минимум 3 символа/i)).toBeInTheDocument();
});

test("successful register calls onAuthenticated", async () => {
  const onAuthenticated = vi.fn();
  vi.spyOn(api, "register").mockResolvedValue({ id: "u1", name: "tester" });
  render(<AuthScreen onAuthenticated={onAuthenticated} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^зарегистрироваться$/i }));
  expect(onAuthenticated).toHaveBeenCalledWith({ id: "u1", name: "tester" });
});

test("a 409 from register shows the nickname-taken error", async () => {
  vi.spyOn(api, "register").mockRejectedValue(new Error("POST /api/auth/register -> 409"));
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^зарегистрироваться$/i }));
  expect(await screen.findByText(/никнейм занят/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- AuthScreen`
Expected: FAIL — `Cannot find module '../AuthScreen.js'`.

- [ ] **Step 3: Implement `AuthScreen`**

Create `web/src/screens/AuthScreen.tsx`:

```tsx
import { useState } from "react";
import {
  Box, Button, Dialog, DialogContent, DialogTitle, Link, Stack, TextField, Typography,
} from "@mui/material";
import { api } from "../api/client.js";
import { nicknameField, passwordField } from "../lib/validation.js";
import { useBackClose } from "../lib/useBackClose.js";
import type { AuthUser } from "../types.js";

type Mode = "register" | "login";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (u: AuthUser) => void }) {
  const [mode, setMode] = useState<Mode>("register");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  useBackClose(forgot, () => setForgot(false));

  const submit = async () => {
    const n = nicknameField.safeParse(nickname);
    if (!n.success) { setError(n.error.issues[0].message); return; }
    const p = passwordField.safeParse(password);
    if (!p.success) { setError(p.error.issues[0].message); return; }
    setError(null);
    setBusy(true);
    try {
      const user = mode === "register"
        ? await api.register(n.data, p.data)
        : await api.login(n.data, p.data);
      onAuthenticated(user);
    } catch (e) {
      const msg = String((e as Error).message);
      if (msg.includes("409")) setError("Никнейм занят");
      else if (msg.includes("401")) setError("Неверный логин или пароль");
      else setError("Не удалось выполнить запрос");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, px: 3 }}>
      <Typography variant="h4" color="primary">Roles Mind Map</Typography>
      <Stack spacing={2} sx={{ width: "100%", maxWidth: 320 }}>
        <TextField label="Логин" value={nickname} inputProps={{ maxLength: 20 }}
          onChange={(e) => setNickname(e.target.value)} />
        <TextField label="Пароль" type="password" value={password} inputProps={{ maxLength: 30 }}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        {error && <Typography color="error" variant="body2">{error}</Typography>}

        {mode === "register" ? (
          <>
            <Button variant="contained" disabled={busy} onClick={submit}>Зарегистрироваться</Button>
            <Button onClick={() => { setError(null); setMode("login"); }}>Уже есть аккаунт</Button>
          </>
        ) : (
          <>
            <Button variant="contained" disabled={busy} onClick={submit}>Войти</Button>
            <Button onClick={() => setForgot(true)}>Забыли пароль?</Button>
          </>
        )}
      </Stack>

      <Dialog open={forgot} onClose={() => setForgot(false)}>
        <DialogTitle>Восстановление пароля</DialogTitle>
        <DialogContent>
          <Typography>
            Для восстановления пароля обратитесь к администратору сайта, контакты указаны на сайте:{" "}
            <Link href="https://mkv.qa/" target="_blank" rel="noopener">https://mkv.qa/</Link>
          </Typography>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- AuthScreen`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/AuthScreen.tsx web/src/screens/__tests__/AuthScreen.test.tsx
git commit -m "feat(web): AuthScreen with register/login modes and forgot-password modal"
```

---

## Task 7: `AuthGate` + wire into `App`

Gate the router: check the session on mount, show `AuthScreen` when anonymous, the app when authenticated.

**Files:**
- Create: `web/src/AuthGate.tsx`
- Modify: `web/src/App.tsx` (wrap routes in `AuthGate`)
- Test: `web/src/__tests__/AuthGate.test.tsx`

**Interfaces:**
- Consumes: `api.me` (Task 5), `AuthScreen` (Task 6).
- Produces: `function AuthGate({ children }: { children: ReactNode })`.

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/AuthGate.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AuthGate } from "../AuthGate.js";
import { api } from "../api/client.js";

test("renders children when /me succeeds", async () => {
  vi.spyOn(api, "me").mockResolvedValue({ id: "u1", name: "tester" });
  render(<AuthGate><div>secret app</div></AuthGate>);
  expect(await screen.findByText("secret app")).toBeInTheDocument();
});

test("renders the auth screen when /me returns 401", async () => {
  vi.spyOn(api, "me").mockRejectedValue(new Error("GET /api/auth/me -> 401"));
  render(<AuthGate><div>secret app</div></AuthGate>);
  await waitFor(() => expect(screen.getByRole("button", { name: /^зарегистрироваться$/i })).toBeInTheDocument());
  expect(screen.queryByText("secret app")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- AuthGate`
Expected: FAIL — `Cannot find module '../AuthGate.js'`.

- [ ] **Step 3: Implement `AuthGate`**

Create `web/src/AuthGate.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { Box, CircularProgress } from "@mui/material";
import { api } from "./api/client.js";
import { AuthScreen } from "./screens/AuthScreen.js";
import type { AuthUser } from "./types.js";

export function AuthGate({ children }: { children: ReactNode }) {
  // undefined = checking, null = anonymous, AuthUser = signed in
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (user === null) return <AuthScreen onAuthenticated={setUser} />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- AuthGate`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into `App.tsx`**

In `web/src/App.tsx`, import `AuthGate` (`import { AuthGate } from "./AuthGate.js";`) and wrap the `<BrowserRouter>...</BrowserRouter>` block in `<AuthGate>...</AuthGate>`:

```tsx
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<BooksScreen />} />
            <Route path="/books/:bookId" element={<BookScreen />} />
          </Routes>
        </BrowserRouter>
      </AuthGate>
```

- [ ] **Step 6: Verify web build + full web tests**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm run test --workspace web`
Expected: tsc exits 0; ALL web tests PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/AuthGate.tsx web/src/App.tsx web/src/__tests__/AuthGate.test.tsx
git commit -m "feat(web): AuthGate gates the SPA behind login"
```

---

## Task 8: Config & docs (secret passthrough, gitignore, CLAUDE.md)

Make the cookie secret stable in Docker and document the feature.

**Files:**
- Modify: `docker-compose.yml` (pass `SESSION_SECRET`)
- Modify: `.gitignore` (ignore the dev secret file)
- Modify: `CLAUDE.md` (document auth + the new gotchas)

**Interfaces:** none (config/docs only).

- [ ] **Step 1: Pass `SESSION_SECRET` through docker-compose**

In `docker-compose.yml`, add an `environment` block to the `app` service:

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      # Optional: set a stable secret to survive container/volume rebuilds.
      # If unset, the server generates one and persists it to /data/session-secret.
      - SESSION_SECRET=${SESSION_SECRET:-}
    volumes:
      - rmm-data:/data
volumes:
  rmm-data:
```

- [ ] **Step 2: Ignore the dev secret file**

Add to `.gitignore`:

```
# Generated cookie-signing secret (dev: next to dev.db)
server/session-secret
session-secret
```

- [ ] **Step 3: Document in CLAUDE.md**

Add a feature paragraph and gotchas to `CLAUDE.md` (under the existing feature list / Gotchas), covering: seeded `synthmadness/6629` admin via `ensureAdminUser` (replaces `ensureDefaultUser`); signed `rmm_session` cookie (10y) + scrypt; nullable `passwordHash` rationale; case-insensitive nickname via raw `LOWER()`; per-user scoping + ownership helpers; `AuthGate`/`AuthScreen`; and that **existing server tests must authenticate via `signIn(app)`**. Keep entries one-paragraph each, matching the file's style.

Suggested gotcha text:

```markdown
- **Auth is cookie-session, no logout** — every `/api/*` route except `/api/auth/*`
  requires the signed `rmm_session` cookie (resolved to `req.user` by the `preHandler`
  in `app.ts`); data routes scope to `req.user.id` with ownership helpers in
  `server/src/ownership.ts` (cross-user id access → 404). `User.passwordHash` is
  **nullable** so `db push` can ADD COLUMN to the populated table; `ensureAdminUser`
  fills it on boot and seeds `synthmadness/6629`, inheriting the legacy `default-user`
  row's books. Nickname uniqueness/login is case-insensitive via raw `LOWER(name)`.
  Server tests that hit data routes must obtain a cookie via `signIn(app)` (helpers).
```

- [ ] **Step 4: Final full verification**

Run: `npm test`
Expected: ALL server + web tests PASS.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .gitignore CLAUDE.md
git commit -m "chore: document auth + pass SESSION_SECRET through docker-compose"
```

---

## Manual verification (after all tasks)

These confirm the end-to-end behaviour Vitest can't fully cover:

1. `npm run dev:server` + `npm run dev:web`, open `http://localhost:5173`.
2. **Migration**: existing data — log in as `synthmadness` / `6629` → the pre-existing book is present.
3. **Register**: open in a fresh browser/profile → register a new nickname → lands straight in the (empty) books list (auto-login). Create a book; log-in-as-admin in another profile does not see it (isolation).
4. **Login toggle**: «Уже есть аккаунт» swaps the buttons to «Войти» / «Забыли пароль?», fields keep their values.
5. **Forgot password**: «Забыли пароль?» shows the contact modal with the `https://mkv.qa/` link; system Back closes it.
6. **Persistence**: reload the page → still authenticated (no re-login). Restart `dev:server` → still authenticated (secret persisted to `server/session-secret`).
```
