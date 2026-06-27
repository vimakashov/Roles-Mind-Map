# Design: `change_pwd.sh` — change an existing user's password

## Goal

Add a server-side admin script that changes the password of an **already existing**
user, invoked the same way as `register_new.sh`:

```bash
username=<username> password=<password> ./change_pwd.sh
```

If the user exists, their password is replaced with the supplied one. If the user
does **not** exist, the script prints exactly:

```
Пользователя с указанным username не существует
```

## Context

This mirrors the existing registration flow one-to-one and reuses its building
blocks, so there is no new validation logic, hashing, or lookup code:

- `register_new.sh` (repo root) → `docker compose exec … app node dist/scripts/registerUser.js`
- `server/src/scripts/registerUser.ts` — `register(env)` returns `{ code, out }`, never throws
- `server/src/services/users.ts` — `findByNameCI`, `createUser`, `NicknameTakenError`
- `server/src/auth.ts` — `hashPassword` (scrypt, `"<salt>:<hash>"`)
- `server/src/schemas.ts` — `passwordSchema` (3–30 chars, printable ASCII)

Nickname lookup is **case-insensitive** via `findByNameCI` (raw `LOWER(name)`,
SQLite has no `mode: "insensitive"`).

## Components

### 1. Service — `server/src/services/users.ts`

Add:

- `class UserNotFoundError extends Error` (mirrors `NicknameTakenError`).
- `async function setPassword(nickname: string, password: string): Promise<{ id: string; name: string }>`:
  1. Validate the new password with the existing `passwordSchema`
     (same rules as registration — 3–30 chars, printable ASCII). A bad
     password throws a `ZodError`.
  2. `const user = await findByNameCI(nickname)` — if `null`, throw
     `UserNotFoundError`.
  3. `prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) }, select: { id: true, name: true } })`.

The nickname is **not** re-validated against `nicknameSchema` (we only need to
look up an existing row; the stored value is already valid). Only the new
password is validated.

### 2. Script — `server/src/scripts/changePassword.ts`

Mirrors `registerUser.ts`: an exported `changePassword(env)` that never throws,
plus the same `isMain` direct-run block (`node dist/scripts/changePassword.js`)
that prints the message, disconnects Prisma, and exits with the code.

```ts
export interface ChangeResult { code: number; out: string; }
export async function changePassword(env: NodeJS.ProcessEnv): Promise<ChangeResult>;
```

Exit codes / messages:

| code | condition | message |
|------|-----------|---------|
| 0 | success | `пароль изменён для <username>` |
| 1 | missing `username` or `password` | `usage: username=<name> password=<password> ./change_pwd.sh` |
| 2 | user not found | `Пользователя с указанным username не существует` |
| 3 | invalid password | `недопустимые данные: <message>` |

(Code 0 → `console.log`; non-zero → `console.error`, matching `registerUser.ts`.)

### 3. Wrapper — `change_pwd.sh` (repo root)

Mirrors `register_new.sh` exactly, only the script name changes:

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

Make it executable (`chmod +x`), matching `register_new.sh`.

## Testing — `server/test/changePassword.test.ts`

Mirrors `registerUser.test.ts` (same `setupTestDb`/`resetData` harness):

- **code 0** — create a user (via `createUser` or `register`), capture its
  `passwordHash`, call `changePassword`, assert `code === 0` and the stored
  `passwordHash` changed.
- **code 1** — missing env vars (`{}`).
- **code 2** — nonexistent username, including a case-insensitivity check
  (existing `dave`, change `"nobody"` → 2).
- **code 3** — existing user, invalid password (e.g. `"ab"`) → 3, and the hash
  is unchanged.

Run the full server suite (`npm run test --workspace server`) before declaring
done — not just the focused file.

## Out of scope / non-goals

- No web/API endpoint — admin-only, server-side, like `register_new.sh`.
- No README change required, but a one-line mention next to `register_new.sh`
  may be added if it fits the existing docs.
- No change to password hashing, schema, or DB structure.
