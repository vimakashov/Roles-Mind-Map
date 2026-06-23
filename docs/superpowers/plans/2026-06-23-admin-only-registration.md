# Admin-only Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove public self-registration; new users are created by an admin running `username=<n> password=<p> ./register_new.sh`, the site landing becomes login-only.

**Architecture:** A shared `createUser` service holds the (unchanged) validate → case-insensitive-unique → scrypt-hash → insert path. The public `POST /api/auth/register` route and `api.register` client method are deleted. A compiled Node entry `dist/scripts/registerUser.js` calls `createUser` from env vars; `register_new.sh` runs it inside the live `app` Docker container via `docker compose exec`. `AuthScreen` is rewritten login-only.

**Tech Stack:** Fastify 4, Prisma 5 (SQLite), zod, Node `crypto` scrypt, Vitest, React 18 + MUI + Vite, Docker Compose.

## Global Constraints

- No schema change, no migration. The `User` table and all existing rows stay untouched.
- New-user creation must behave **identically** to today's registration: validate with `registerSchema`, case-insensitive uniqueness via `LOWER(name)` raw SQL, password hashed with `hashPassword` (scrypt, `"<salt>:<hash>"`).
- Password hash format produced by `hashPassword`: `<32-hex-salt>:<128-hex-hash>`.
- Production: Docker Compose service is named `app`; SQLite DB at `file:/data/app.db` on the `rmm-data` named volume. The script reaches the DB only via `docker compose exec` into `app` — no host DB access.
- Server compiles `src/**` → `dist/**` (`tsconfig.json`: `rootDir: src`, `outDir: dist`, `include: ["src"]`), so `src/scripts/registerUser.ts` → `dist/scripts/registerUser.js` ships in the image automatically.
- Russian UI copy stays exactly as written in the code blocks below.
- Full `npm run test --workspace server` and `npm run test --workspace web` must pass, plus `npx tsc --noEmit -p web/tsconfig.json` and `npm run build --workspace server`.

---

## File Structure

- Create `server/src/services/users.ts` — shared `createUser` + `findByNameCI` + `NicknameTakenError`.
- Modify `server/src/routes/auth.ts` — delete register route; login imports `findByNameCI` from the service.
- Modify `server/test/helpers.ts` — `signIn()` uses `createUser` + login instead of the register route.
- Modify `server/test/auth-api.test.ts` — drop register-route cases, assert register is now 404.
- Create `server/test/users.test.ts` — unit tests for `createUser`.
- Create `server/src/scripts/registerUser.ts` — testable `register(env)` + a run-as-main CLI runner.
- Create `server/test/registerUser.test.ts` — unit tests for `register(env)`.
- Create `register_new.sh` (repo root) — `docker compose exec` wrapper.
- Modify `web/src/screens/AuthScreen.tsx` — login-only rewrite.
- Modify `web/src/api/client.ts` — delete `api.register`.
- Modify `web/src/screens/__tests__/AuthScreen.test.tsx` — login-only tests.
- Modify `web/src/__tests__/AuthGate.test.tsx` — assert «Войти» instead of «Зарегистрироваться».
- Modify `CLAUDE.md` — update the auth section.

---

## Task 1: Shared `createUser` service + remove public register route

**Files:**
- Create: `server/src/services/users.ts`
- Modify: `server/src/routes/auth.ts`
- Modify: `server/test/helpers.ts:38-44`
- Modify: `server/test/auth-api.test.ts:11-38`
- Test: `server/test/users.test.ts`

**Interfaces:**
- Consumes: `prisma` (`../db.js`), `hashPassword` (`../auth.js`), `registerSchema` (`../schemas.js`), `Prisma` (`@prisma/client`).
- Produces:
  - `class NicknameTakenError extends Error`
  - `findByNameCI(nickname: string): Promise<{ id: string; name: string; passwordHash: string | null } | null>`
  - `createUser(nickname: string, password: string): Promise<{ id: string; name: string }>` — throws `NicknameTakenError` on a duplicate, throws `ZodError` on invalid input.

- [ ] **Step 1: Write the failing test**

Create `server/test/users.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace server -- users`
Expected: FAIL — cannot resolve `../src/services/users.js` (module does not exist yet).

- [ ] **Step 3: Create the service**

Create `server/src/services/users.ts`:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { hashPassword } from "../auth.js";
import { registerSchema } from "../schemas.js";

export class NicknameTakenError extends Error {
  constructor() {
    super("nickname taken");
    this.name = "NicknameTakenError";
  }
}

/** Case-insensitive lookup (Prisma SQLite has no `mode: "insensitive"`). */
export async function findByNameCI(nickname: string) {
  const rows = await prisma.$queryRaw<{ id: string; name: string; passwordHash: string | null }[]>(
    Prisma.sql`SELECT id, name, passwordHash FROM User WHERE LOWER(name) = LOWER(${nickname}) LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** Create a user the same way registration did: validate, CI-unique check, scrypt hash. */
export async function createUser(nickname: string, password: string): Promise<{ id: string; name: string }> {
  const { nickname: n, password: p } = registerSchema.parse({ nickname, password });
  if (await findByNameCI(n)) throw new NicknameTakenError();
  return prisma.user.create({
    data: { name: n, passwordHash: hashPassword(p) },
    select: { id: true, name: true },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace server -- users`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite `routes/auth.ts` to drop register and reuse `findByNameCI`**

Replace the entire contents of `server/src/routes/auth.ts` with:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { verifyPassword, SESSION_COOKIE, SESSION_MAX_AGE } from "../auth.js";
import { loginSchema } from "../schemas.js";
import { findByNameCI } from "../services/users.js";

function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(SESSION_COOKIE, userId, {
    signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
  });
}

export async function authRoutes(app: FastifyInstance) {
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

- [ ] **Step 6: Repoint `signIn()` in the test helper**

In `server/test/helpers.ts`, add `createUser` to the imports and rewrite `signIn`.

Add this import near the top (after the existing `../src/...` imports):

```ts
import { createUser } from "../src/services/users.js";
```

Replace the existing `signIn` function (lines 38-44) with:

```ts
/** Create a user, log them in, and return a `cookie` header string carrying their session. */
export async function signIn(app: FastifyInstance, nickname = "tester", password = "pass1"): Promise<string> {
  await createUser(nickname, password);
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname, password } });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error(`signIn failed: ${res.statusCode} ${res.body}`);
  return `${SESSION_COOKIE}=${c.value}`;
}
```

- [ ] **Step 7: Update `auth-api.test.ts` — remove register cases, assert register 404**

In `server/test/auth-api.test.ts`, delete the three register tests (the `test("register creates...")`, `test("register rejects a duplicate...")`, and `test("register rejects an invalid nickname...")` blocks, lines 11-38). In their place add:

```ts
test("the public register route no longer exists (404)", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { nickname: "tester", password: "pass1" },
  });
  expect(res.statusCode).toBe(404);
});
```

Leave the login/me tests (the seeded-admin login, case-insensitive login, wrong-password 401, me-without-session 401) unchanged.

- [ ] **Step 8: Run the full server suite**

Run: `npm run test --workspace server`
Expected: PASS — all suites green (users, auth-api, books, characters, relationships, avatar, api, etc.). The register route is gone; `signIn` now works via `createUser` + login.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/users.ts server/src/routes/auth.ts server/test/helpers.ts server/test/auth-api.test.ts server/test/users.test.ts
git commit -m "feat(server): extract createUser service, remove public register route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Admin registration script

**Files:**
- Create: `server/src/scripts/registerUser.ts`
- Create: `register_new.sh` (repo root)
- Test: `server/test/registerUser.test.ts`

**Interfaces:**
- Consumes: `createUser`, `NicknameTakenError` (`../services/users.js` from Task 1); `prisma` (`../db.js`).
- Produces: `register(env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }>` — never throws; `code` is `0` success, `1` missing env, `2` duplicate nickname, `3` invalid input.

- [ ] **Step 1: Write the failing test**

Create `server/test/registerUser.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace server -- registerUser`
Expected: FAIL — cannot resolve `../src/scripts/registerUser.js`.

- [ ] **Step 3: Create the script**

Create `server/src/scripts/registerUser.ts`:

```ts
import { pathToFileURL } from "node:url";
import { createUser, NicknameTakenError } from "../services/users.js";
import { prisma } from "../db.js";

export interface RegisterResult {
  code: number;
  out: string;
}

/** Create a user from env-provided credentials. Returns an exit code + message; never throws. */
export async function register(env: NodeJS.ProcessEnv): Promise<RegisterResult> {
  const username = env.username?.trim();
  const password = env.password;
  if (!username || !password) {
    return { code: 1, out: "usage: username=<name> password=<password> ./register_new.sh" };
  }
  try {
    const user = await createUser(username, password);
    return { code: 0, out: `created user ${user.name} (${user.id})` };
  } catch (e) {
    if (e instanceof NicknameTakenError) return { code: 2, out: `никнейм занят: ${username}` };
    return { code: 3, out: `недопустимые данные: ${(e as Error).message}` };
  }
}

// Run only when executed directly (`node dist/scripts/registerUser.js`), not on import (tests).
const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  register(process.env)
    .then(async ({ code, out }) => {
      (code === 0 ? console.log : console.error)(out);
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(99);
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace server -- registerUser`
Expected: PASS (4 tests). The `isMain` guard is false under Vitest, so importing the module does not invoke the CLI runner.

- [ ] **Step 5: Create the shell wrapper**

Create `register_new.sh` at the repo root:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${username:?username is required — usage: username=<name> password=<password> ./register_new.sh}"
: "${password:?password is required — usage: username=<name> password=<password> ./register_new.sh}"

exec docker compose exec -T \
  -e username="$username" \
  -e password="$password" \
  app node dist/scripts/registerUser.js
```

- [ ] **Step 6: Make the script executable**

Run: `chmod +x register_new.sh`
Expected: no output; `git diff --stat` later shows mode `100644 → 100755`.

- [ ] **Step 7: Build the server to confirm the script compiles into dist**

Run: `npm run build --workspace server`
Expected: PASS (`tsc` exits 0). Confirm the artifact exists:
Run: `ls server/dist/scripts/registerUser.js`
Expected: the file is listed.

- [ ] **Step 8: Commit**

```bash
git add server/src/scripts/registerUser.ts server/test/registerUser.test.ts register_new.sh
git commit -m "feat(server): add register_new.sh admin script for creating users

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 9: Manual smoke test (cannot be unit-tested — Docker)**

This step is run by the operator on a machine with Docker, not by the automated suite. After `docker compose up --build` is running:

```bash
username=smoketest password=secret9 ./register_new.sh   # expect: created user smoketest (<id>), exit 0
username=smoketest password=secret9 ./register_new.sh   # expect: никнейм занят: smoketest, exit 2
username=ab password=secret9 ./register_new.sh          # expect: недопустимые данные: ..., exit 3
./register_new.sh                                       # expect: usage error, non-zero exit
```

Then verify the first user can log in through the web UI. No commit (manual verification only).

---

## Task 3: Login-only auth screen (web)

**Files:**
- Modify: `web/src/screens/AuthScreen.tsx`
- Modify: `web/src/api/client.ts:45-47`
- Test: `web/src/screens/__tests__/AuthScreen.test.tsx`
- Modify: `web/src/__tests__/AuthGate.test.tsx:15`

**Interfaces:**
- Consumes: `api.login` (`../api/client.js`), `nicknameField`/`passwordField` (`../lib/validation.js`), `useBackClose` (`../lib/useBackClose.js`), `AuthUser` (`../types.js`).
- Produces: `AuthScreen({ onAuthenticated }: { onAuthenticated: (u: AuthUser) => void })` — renders exactly two buttons, «Войти» and «Забыли пароль?»; no register UI.

- [ ] **Step 1: Rewrite the test first**

Replace the entire contents of `web/src/screens/__tests__/AuthScreen.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";
import { AuthScreen } from "../AuthScreen.js";
import { __resetBackStack } from "../../lib/backStack.js";
import { api } from "../../api/client.js";

beforeEach(() => __resetBackStack());

test("shows only login + forgot-password buttons, no registration UI", () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  expect(screen.getByRole("button", { name: /^войти$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /забыли пароль/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /зарегистрироваться/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /уже есть аккаунт/i })).not.toBeInTheDocument();
});

test("«Забыли пароль?» opens the contact modal with the site link", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /забыли пароль/i }));
  expect(screen.getByText(/обратитесь к администратору сайта/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /mkv\.qa/i })).toHaveAttribute("href", "https://mkv.qa/");
});

test("shows a validation error for a too-short nickname", async () => {
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "ab");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^войти$/i }));
  expect(await screen.findByText(/минимум 3 символа/i)).toBeInTheDocument();
});

test("successful login calls onAuthenticated", async () => {
  const onAuthenticated = vi.fn();
  vi.spyOn(api, "login").mockResolvedValue({ id: "u1", name: "tester" });
  render(<AuthScreen onAuthenticated={onAuthenticated} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^войти$/i }));
  expect(onAuthenticated).toHaveBeenCalledWith({ id: "u1", name: "tester" });
});

test("a 401 from login shows the invalid-credentials error", async () => {
  vi.spyOn(api, "login").mockRejectedValue(new Error("POST /api/auth/login -> 401"));
  render(<AuthScreen onAuthenticated={() => {}} />);
  await userEvent.type(screen.getByLabelText(/логин/i), "tester");
  await userEvent.type(screen.getByLabelText(/пароль/i), "pass1");
  await userEvent.click(screen.getByRole("button", { name: /^войти$/i }));
  expect(await screen.findByText(/неверный логин или пароль/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- AuthScreen`
Expected: FAIL — the current screen still renders «Зарегистрироваться» and defaults to register mode, so the new assertions fail.

- [ ] **Step 3: Rewrite `AuthScreen.tsx`**

Replace the entire contents of `web/src/screens/AuthScreen.tsx` with:

```tsx
import { useState } from "react";
import {
  Box, Button, Dialog, DialogContent, DialogTitle, Link, Stack, TextField, Typography,
} from "@mui/material";
import { api } from "../api/client.js";
import { nicknameField, passwordField } from "../lib/validation.js";
import { useBackClose } from "../lib/useBackClose.js";
import type { AuthUser } from "../types.js";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (u: AuthUser) => void }) {
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
      const user = await api.login(n.data, p.data);
      onAuthenticated(user);
    } catch (e) {
      const msg = String((e as Error).message);
      if (msg.includes("401")) setError("Неверный логин или пароль");
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
        <Button variant="contained" disabled={busy} onClick={submit}>Войти</Button>
        <Button onClick={() => setForgot(true)}>Забыли пароль?</Button>
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

- [ ] **Step 4: Delete `api.register`**

In `web/src/api/client.ts`, remove the `register` method (lines 45-47):

```ts
  register: (nickname: string, password: string) =>
    req<AuthUser>("/api/auth/register", { method: "POST", body: JSON.stringify({ nickname, password }) }),
```

Leave `login`, `me`, and the rest of the object intact (the next property is `login:`).

- [ ] **Step 5: Update the AuthGate test assertion**

In `web/src/__tests__/AuthGate.test.tsx`, line 15 currently asserts the «Зарегистрироваться» button. Replace that line:

```tsx
  await waitFor(() => expect(screen.getByRole("button", { name: /^зарегистрироваться$/i })).toBeInTheDocument());
```

with:

```tsx
  await waitFor(() => expect(screen.getByRole("button", { name: /^войти$/i })).toBeInTheDocument());
```

- [ ] **Step 6: Run the web suite**

Run: `npm run test --workspace web`
Expected: PASS — AuthScreen, AuthGate, and all other web suites green.

- [ ] **Step 7: Type-check the web bundle**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: exits 0 (no `api.register` references remain; `AuthUser` is still imported by `client.ts` via `login`/`me`).

- [ ] **Step 8: Commit**

```bash
git add web/src/screens/AuthScreen.tsx web/src/api/client.ts web/src/screens/__tests__/AuthScreen.test.tsx web/src/__tests__/AuthGate.test.tsx
git commit -m "feat(web): login-only auth screen, remove self-registration UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Update CLAUDE.md auth documentation

**Files:**
- Modify: `CLAUDE.md` (the **Auth** architecture paragraph and the **Auth is cookie-session** gotcha)

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing.

- [ ] **Step 1: Update the AuthScreen description**

In `CLAUDE.md`, find this text inside the **Auth (nickname + password, cookie session, no logout)** paragraph:

```
`web/src/screens/AuthScreen.tsx`: register/login mode toggle, inline zod errors via `nicknameField`/`passwordField`, a «Забыли пароль?» modal pointing at `https://mkv.qa/`
```

Replace it with:

```
`web/src/screens/AuthScreen.tsx`: **login-only** (no self-registration UI) — login + «Забыли пароль?» buttons, inline zod errors via `nicknameField`/`passwordField`, a «Забыли пароль?» modal pointing at `https://mkv.qa/`
```

- [ ] **Step 2: Update the routes description**

In the same paragraph, find:

```
`server/src/routes/auth.ts` exposes `POST /api/auth/register` (201 + cookie, 409 on duplicate), `POST /api/auth/login` (200 + cookie, 401 on bad creds), `GET /api/auth/me`.
```

Replace it with:

```
`server/src/routes/auth.ts` exposes `POST /api/auth/login` (200 + cookie, 401 on bad creds) and `GET /api/auth/me`. **There is no public register route** — self-registration is disabled. New users are created only by an admin running `username=<n> password=<p> ./register_new.sh` (repo root), which `docker compose exec`s `node dist/scripts/registerUser.js` inside the `app` container; that calls the shared `createUser` service (`server/src/services/users.ts`: same `registerSchema` validation, case-insensitive `findByNameCI`, scrypt `hashPassword`). The `login` route imports `findByNameCI` from that service.
```

- [ ] **Step 3: Update the cookie-session gotcha**

In the **Gotchas** section, find this sentence in the **Auth is cookie-session, no logout** entry:

```
Server tests that hit data routes must obtain a cookie via `signIn(app)` (`server/test/helpers.ts`) and inject it
```

Replace it with:

```
Server tests that hit data routes must obtain a cookie via `signIn(app)` (`server/test/helpers.ts` — now `createUser` + `POST /api/auth/login`, since the register route was removed) and inject it
```

- [ ] **Step 4: Run the full test suite as a final guard**

Run: `npm test`
Expected: PASS — both server and web workspaces green.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document admin-only registration in CLAUDE.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §1 shared service → Task 1; §2 disable self-registration (route + `api.register`) → Tasks 1 & 3; §3 login-only screen → Task 3; §4 script (`registerUser.ts` + `register_new.sh`) → Task 2; §5 tests/docs → Tasks 1–4. All covered.
- **Test fallout from removing the register route:** `signIn()` repointed (Task 1 Step 6), `auth-api.test.ts` register cases removed + 404 assertion (Step 7), `AuthGate.test.tsx:15` re-asserted (Task 3 Step 5).
- **Type consistency:** `createUser`/`findByNameCI`/`NicknameTakenError` defined in Task 1 are consumed with identical signatures in Tasks 1–2; `register(env)` returns `{ code, out }` used consistently in Task 2.
- **No Docker in CI:** the shell wrapper's behaviour is covered by `register(env)` unit tests (Task 2 Steps 1-4); the `docker compose exec` plumbing is a documented manual smoke test (Task 2 Step 9).
