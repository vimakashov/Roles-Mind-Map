# Admin-only registration via server script

**Date:** 2026-06-23
**Status:** Approved (design)

## Goal

Remove the ability for visitors to self-register on the site. The public landing
becomes a **login-only** screen. Creating new users moves to an **admin-run shell
script** on the server, invoked as:

```bash
username=<name> password=<password> ./register_new.sh
```

Existing users and the existing database **must not be touched** — only the *path*
by which new accounts are created changes. Login, sessions, the admin seed, and all
data remain exactly as today.

## Constraints

- No schema change, no migration. `User` table and all rows are untouched.
- New-user creation must behave **identically** to today's registration: same
  validation (`registerSchema`), same case-insensitive uniqueness, same scrypt
  password hashing (`hashPassword`).
- Production runs in Docker; the SQLite DB lives inside the container's `/data`
  named volume (`rmm-data`). The script reaches it via `docker compose exec` into
  the running `app` service — it does **not** require the DB to be host-accessible.
- `npm test` (server + web) stays green.

## Architecture

Four moving parts, sharing one validated user-creation path.

### 1. Shared user-creation service (single source of truth)

New file **`server/src/services/users.ts`** exporting:

```ts
export class NicknameTakenError extends Error {}

export async function createUser(
  nickname: string,
  password: string,
): Promise<{ id: string; name: string }>;
```

Behaviour (lifted verbatim from today's `register` route, no logic change):

1. Validate `{ nickname, password }` with `registerSchema`. On failure, throw an
   `Error` whose message carries the flattened zod issues (callers map to exit
   code / 400-equivalent).
2. Case-insensitive existence check via the `LOWER(name)` raw query. The
   `findByNameCI` helper currently in `routes/auth.ts` **moves into
   `services/users.ts`** and is exported; the `login` route imports it from there
   (no duplicate copy).
3. `prisma.user.create({ data: { name: nickname, passwordHash: hashPassword(password) }, select: { id, name } })`.
4. On a duplicate, throw `NicknameTakenError`.

This is the **exact** insert registration does today, so existing data is unaffected.

### 2. Disable self-registration (server + web client)

- **Delete** `POST /api/auth/register` from `server/src/routes/auth.ts`. With the
  route gone there is no public registration endpoint at all (the strongest reading
  of "disable self-registration"). `POST /api/auth/login` and `GET /api/auth/me`
  are unchanged.
- **Delete** `api.register` from `web/src/api/client.ts`.
- `registerSchema` / `nicknameSchema` / `passwordSchema` in `server/src/schemas.ts`
  stay — they are now consumed by `createUser`.

### 3. Login-only auth screen (web)

Rewrite **`web/src/screens/AuthScreen.tsx`**:

- Remove the `Mode` type, the `mode` state, and the register/login toggle.
- Render exactly: title, **Логин** field (`maxLength 20`), **Пароль** field
  (`type=password`, `maxLength 30`, Enter submits), inline error line, then two
  buttons — **Войти** (contained, calls `api.login`) and **Забыли пароль?** (opens
  the existing recovery `Dialog` pointing at `https://mkv.qa/`).
- `submit()` validates with `nicknameField` / `passwordField` then calls
  `api.login` only; keep the 401 → «Неверный логин или пароль» mapping, drop the
  409 branch (no registration path remains).

### 4. The admin script

**`server/src/scripts/registerUser.ts`** → compiled to `dist/scripts/registerUser.js`
(picked up automatically by `tsc -p tsconfig.json`, already copied into the runtime
image via `COPY server/dist`). It:

1. Reads `process.env.username` and `process.env.password`.
2. If either is missing/empty, prints usage to stderr and exits `1`.
3. Calls `createUser(username, password)`.
4. On success prints e.g. `created user <name> (<id>)` and exits `0`.
5. On `NicknameTakenError` prints «никнейм занят» and exits `2`; on validation
   error prints the message and exits `3`; disconnects Prisma in a `finally`.

**`register_new.sh`** (repo root, `chmod +x`): thin host-side wrapper.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${username:?username is required: username=<name> password=<password> ./register_new.sh}"
: "${password:?password is required: username=<name> password=<password> ./register_new.sh}"

docker compose exec -T \
  -e username="$username" \
  -e password="$password" \
  app node dist/scripts/registerUser.js
```

The insert runs inside the live `app` container against `/data/app.db`. The script
forwards the container's exit code and stdout/stderr to the admin. `-T` disables TTY
allocation so it works in non-interactive shells.

## Data flow

```
admin shell:  username=bob password=hunter2 ./register_new.sh
  └─ docker compose exec app node dist/scripts/registerUser.js  (env: username, password)
       └─ createUser("bob","hunter2")
            ├─ registerSchema.parse        → 400-equivalent on bad input (exit 3)
            ├─ findByNameCI("bob")         → NicknameTakenError on dup (exit 2)
            └─ prisma.user.create(hashPassword) → { id, name }  (exit 0)
```

Web visitor: lands on `AuthScreen` → only **Войти** (POST /api/auth/login) and
**Забыли пароль?**. No registration UI, no registration endpoint.

## Error handling

- Missing `username`/`password` env → wrapper aborts (`set -u` / `:?`) before exec.
- App container not running → `docker compose exec` fails; its error surfaces.
- Invalid nickname/password → non-zero exit + the zod message.
- Duplicate nickname → non-zero exit + «никнейм занят»; no row written.
- Login 401 on the web is unchanged.

## Testing

- **New:** `server/test/users.test.ts` — `createUser` creates a user, rejects a
  duplicate (case-insensitive) with `NicknameTakenError`, and rejects invalid
  input. (Replaces the deleted register-route HTTP tests.)
- **Update `server/test/helpers.ts`:** `signIn()` no longer hits the removed
  register route — it calls `createUser()` directly, then injects
  `POST /api/auth/login` and returns that response's `rmm_session` cookie header
  (the login route remains the one place that signs the cookie).
- **Update `server/test/auth-api.test.ts`:** remove the three register-route cases;
  keep/extend the login + me cases. Add a case asserting `POST /api/auth/register`
  now returns 404 (route removed).
- **Update `web/src/screens/__tests__/AuthScreen.test.tsx`:** drop register-mode
  tests; assert the login-only layout (two buttons, login submits, 401 error), and
  that the recovery dialog opens.
- Run the **full** `npm run test --workspace server` and `--workspace web`, plus
  `npx tsc --noEmit -p web/tsconfig.json` and the server build (`tsc`) so the new
  script file type-checks.

## Out of scope (YAGNI)

- No password reset, no admin web UI, no user listing/deletion script.
- No rate limiting / lockout changes.
- No change to sessions, the admin seed (`ensureAdminUser`), or sharing.

## Docs

Update `CLAUDE.md`'s auth section: self-registration is disabled (public
`/api/auth/register` removed, `AuthScreen` is login-only), and new users are created
by an admin via `username=<n> password=<p> ./register_new.sh`, which runs
`dist/scripts/registerUser.js` inside the `app` container through the shared
`createUser` service.
