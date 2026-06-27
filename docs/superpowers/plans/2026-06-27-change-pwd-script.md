# change_pwd.sh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side admin script `change_pwd.sh` that changes an existing user's password, printing a clear message when the user does not exist.

**Architecture:** Mirror the existing registration flow one-to-one. A new service function `setPassword` reuses `findByNameCI` + `hashPassword` + `passwordSchema`; a new script `changePassword.ts` wraps it with exit-code/message handling (mirroring `registerUser.ts`); a thin `change_pwd.sh` `docker compose exec`s the compiled script.

**Tech Stack:** Node 20, TypeScript (ESM, `.js` import specifiers), Prisma 5 + SQLite, Zod, Vitest, Bash.

## Global Constraints

- All TS imports use `.js` specifiers (ESM), even for local files.
- Nickname lookup is **case-insensitive** — use `findByNameCI`, never `prisma.user.findFirst({ where: { name } })`.
- New password is validated with the existing `passwordSchema` (3–30 chars, printable ASCII `\x21-\x7E`). Do not re-validate the nickname against `nicknameSchema`.
- The user-not-found message must be **exactly**: `Пользователя с указанным username не существует`
- Scripts/services live in `server/`; the Bash wrapper at repo root mirrors `register_new.sh` (`docker compose exec -T`).
- Run the **full** server suite (`npm run test --workspace server`) before declaring done.

---

### Task 1: `setPassword` service + `UserNotFoundError`

**Files:**
- Modify: `server/src/services/users.ts`
- Test: `server/test/users.test.ts` (add cases; do not rewrite existing ones)

**Interfaces:**
- Consumes: `findByNameCI(nickname)` → `{ id, name, passwordHash } | null`; `hashPassword(plain)` → `string`; `passwordSchema` from `../schemas.js`; `prisma` from `../db.js`.
- Produces:
  - `class UserNotFoundError extends Error` (`name = "UserNotFoundError"`)
  - `async function setPassword(nickname: string, password: string): Promise<{ id: string; name: string }>` — throws `ZodError` on invalid password, `UserNotFoundError` if no user matches (CI).

- [ ] **Step 1: Write the failing tests**

Append to `server/test/users.test.ts`. First check the file's existing imports — it already imports from `../src/services/users.js` and the test helpers. Add `setPassword, UserNotFoundError` to that existing import, and `verifyPassword` from `../src/auth.js`. Then add:

```ts
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
```

If `users.test.ts` does not already import `createUser`/`findByNameCI`, add them to the existing service import. Confirm the test file already calls `setupTestDb()`/`resetData()` like the other suites; if not present, copy the `beforeAll`/`beforeEach`/`afterAll` block from `server/test/registerUser.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace server -- users`
Expected: FAIL — `setPassword`/`UserNotFoundError` not exported.

- [ ] **Step 3: Implement in `server/src/services/users.ts`**

Add `passwordSchema` to the existing schemas import:

```ts
import { passwordSchema, registerSchema } from "../schemas.js";
```

Add after `NicknameTakenError`:

```ts
export class UserNotFoundError extends Error {
  constructor() {
    super("user not found");
    this.name = "UserNotFoundError";
  }
}
```

Add at the end of the file:

```ts
/** Change an existing user's password. CI nickname lookup; validates the new password only. */
export async function setPassword(nickname: string, password: string): Promise<{ id: string; name: string }> {
  const p = passwordSchema.parse(password);
  const user = await findByNameCI(nickname);
  if (!user) throw new UserNotFoundError();
  return prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(p) },
    select: { id: true, name: true },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace server -- users`
Expected: PASS (existing + 3 new cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/users.ts server/test/users.test.ts
git commit -m "feat(server): setPassword service for changing an existing user's password"
```

---

### Task 2: `changePassword` script

**Files:**
- Create: `server/src/scripts/changePassword.ts`
- Test: `server/test/changePassword.test.ts`

**Interfaces:**
- Consumes: `setPassword`, `UserNotFoundError` from `../services/users.js`; `prisma` from `../db.js`.
- Produces:
  - `interface ChangeResult { code: number; out: string; }`
  - `async function changePassword(env: NodeJS.ProcessEnv): Promise<ChangeResult>` — never throws. Codes: `0` success, `1` missing env vars, `2` user not found, `3` invalid password.

- [ ] **Step 1: Write the failing test**

Create `server/test/changePassword.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace server -- changePassword`
Expected: FAIL — cannot find module `../src/scripts/changePassword.js`.

- [ ] **Step 3: Implement `server/src/scripts/changePassword.ts`**

Mirrors `registerUser.ts` structure exactly:

```ts
import { pathToFileURL } from "node:url";
import { setPassword, UserNotFoundError } from "../services/users.js";
import { prisma } from "../db.js";

export interface ChangeResult {
  code: number;
  out: string;
}

/** Change an existing user's password from env-provided credentials. Returns an exit code + message; never throws. */
export async function changePassword(env: NodeJS.ProcessEnv): Promise<ChangeResult> {
  const username = env.username?.trim();
  const password = env.password;
  if (!username || !password) {
    return { code: 1, out: "usage: username=<name> password=<password> ./change_pwd.sh" };
  }
  try {
    const user = await setPassword(username, password);
    return { code: 0, out: `пароль изменён для ${user.name}` };
  } catch (e) {
    if (e instanceof UserNotFoundError) return { code: 2, out: "Пользователя с указанным username не существует" };
    return { code: 3, out: `недопустимые данные: ${(e as Error).message}` };
  }
}

// Run only when executed directly (`node dist/scripts/changePassword.js`), not on import (tests).
const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  changePassword(process.env)
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace server -- changePassword`
Expected: PASS (4 cases).

- [ ] **Step 5: Verify the build compiles (tsc, not just esbuild/Vitest)**

Run: `npm run build --workspace server`
Expected: exits 0, emits `server/dist/scripts/changePassword.js`.

- [ ] **Step 6: Commit**

```bash
git add server/src/scripts/changePassword.ts server/test/changePassword.test.ts
git commit -m "feat(server): changePassword script with not-found message + exit codes"
```

---

### Task 3: `change_pwd.sh` wrapper

**Files:**
- Create: `change_pwd.sh` (repo root)

**Interfaces:**
- Consumes: compiled `server/dist/scripts/changePassword.js` inside the `app` container.
- Produces: a repo-root executable invoked as `username=<u> password=<p> ./change_pwd.sh`.

- [ ] **Step 1: Create `change_pwd.sh`**

Mirrors `register_new.sh` exactly — only the usage text and final script name differ:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${username:?username is required — usage: username=<name> password=<password> ./change_pwd.sh}"
: "${password:?password is required — usage: username=<name> password=<password> ./change_pwd.sh}"

exec docker compose exec -T \
  -e username="$username" \
  -e password="$password" \
  app node dist/scripts/changePassword.js
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x change_pwd.sh`

- [ ] **Step 3: Verify it errors fast without env vars (no Docker needed)**

Run: `./change_pwd.sh; echo "exit=$?"`
Expected: prints a line containing `username is required` and `exit=1` (the `set -u` / `:?` guard fires before any `docker` call).

- [ ] **Step 4: Commit**

```bash
git add change_pwd.sh
git commit -m "feat: change_pwd.sh wrapper to run the password-change script in Docker"
```

---

### Task 4: Documentation + full-suite verification

**Files:**
- Modify: `CLAUDE.md` (Auth section, near the `register_new.sh` description)
- Modify: `README.md` (only if it documents `register_new.sh`; otherwise skip)

**Interfaces:**
- Consumes: nothing. Produces: docs only.

- [ ] **Step 1: Check whether README mentions `register_new.sh`**

Run: `grep -rn "register_new.sh" README.md CLAUDE.md`
Expected: at least the CLAUDE.md Auth-section reference. Note each location to mirror.

- [ ] **Step 2: Add a `change_pwd.sh` note in CLAUDE.md**

In the **Auth** section, right after the sentence describing `register_new.sh` creating users, add one sentence:

> Existing users' passwords are changed by an admin running `username=<n> password=<p> ./change_pwd.sh` (repo root), which `docker compose exec`s `node dist/scripts/changePassword.js` → the shared `setPassword` service (`server/src/services/users.ts`: same `passwordSchema` validation, case-insensitive `findByNameCI`, scrypt `hashPassword`); a missing user prints «Пользователя с указанным username не существует».

If `README.md` documents `register_new.sh` for end users, add an equivalent one-line mention there too; otherwise leave README unchanged.

- [ ] **Step 3: Run the full server test suite**

Run: `npm run test --workspace server`
Expected: PASS (all suites, including the new `users`/`changePassword` cases).

- [ ] **Step 4: Verify the server build once more**

Run: `npm run build --workspace server`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document change_pwd.sh password-change script"
```

---

## Self-Review

**Spec coverage:**
- Service `setPassword` + `UserNotFoundError` → Task 1. ✓
- Script `changePassword.ts` (exit codes 0/1/2/3, exact not-found message) → Task 2. ✓
- `change_pwd.sh` wrapper → Task 3. ✓
- Tests mirroring `registerUser.test.ts` (codes 0/1/2/3, hash-changed, CI miss, unchanged-on-invalid) → Tasks 1 (service) + 2 (script). ✓
- Password validated with `passwordSchema`; nickname not re-validated → Task 1 constraint + impl. ✓
- Out-of-scope items (no API/web endpoint, no schema change) → respected; only docs touched in Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `setPassword(nickname, password): Promise<{id,name}>`, `UserNotFoundError`, `ChangeResult {code,out}`, `changePassword(env): Promise<ChangeResult>` used identically across Tasks 1–2. The exact not-found string matches in service-less script (Task 2) and docs (Task 4). ✓
