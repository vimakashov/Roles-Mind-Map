# Simple registration & login — design

Date: 2026-06-23
Status: approved (design); pending spec review before planning

## Goal

Add the simplest possible per-user accounts (nickname + password) so each user
gets an isolated space of books/characters. No password-complexity rules. Existing
data (currently one book under the hardcoded local user) is migrated onto a seeded
`synthmadness` admin account. Authentication persists via a long-lived cookie; there
is **no logout** (switching accounts requires clearing browser cookies).

## Constraints

- **Pure-JS server, no native deps** (existing project constraint). Password hashing
  uses Node's built-in `crypto.scrypt`; sessions use `@fastify/cookie` (pure JS).
  bcrypt/argon2 are explicitly **out** (native bindings).
- Keep the existing architecture: Fastify 4 + Prisma 5 + SQLite; React 18 + MUI +
  react-router SPA served by the same server in production.

## Decisions (locked)

- **Session mechanism**: signed `httpOnly` cookie holding the userId (Option A).
  No server-side session table, no JWT.
- **Seed account**: login `synthmadness`, password `6629`.
- **No logout** action anywhere.
- **Caps**: nickname 3–20 chars; password 3–30 chars.

### Known trade-off (accepted)

`synthmadness / 6629` is a fixed, known credential and there is no logout. Anyone
who knows it can log in as that account from any browser. This is inherent to the
requested behaviour and accepted as-is.

---

## 1. Data model & migration

### `User` schema (`server/prisma/schema.prisma`)

Repurpose the existing `name` field as the login (nickname) and add a password hash:

```prisma
model User {
  id           String   @id @default(cuid())
  name         String   @unique   // nickname / login; case-insensitive uniqueness enforced in code
  passwordHash String?               // scrypt, stored as "<saltHex>:<hashHex>"; nullable so `db push` can ADD COLUMN to the populated table (see below). Filled on boot for the seed; always set for real accounts.
  createdAt    DateTime @default(now())
  books        Book[]
}
```

`passwordHash` is **nullable on purpose**: SQLite cannot `ADD COLUMN ... NOT NULL` (no default)
to a table that already has rows, and Prisma `db push --accept-data-loss` could otherwise rebuild
and drop the existing user (cascading its books). A `null` hash means a not-yet-migrated/credential-less
row that cannot log in; `ensureAdminUser` fills it immediately after the push. `register`/`login`
always write/require a non-null hash.

`Book.userId` and the rest of the schema are unchanged.

### Migration on boot (`ensureAdminUser`, idempotent)

Replace `ensureDefaultUser()` (`server/src/defaultUser.ts`) with `ensureAdminUser()`,
called from `server.ts` after `prisma db push` (same spot as today):

- **Upsert** the existing `default-user` row → set `name = "synthmadness"`,
  `passwordHash = hashPassword("6629")`. Reusing the same row id means **all current
  books stay attached automatically** (the existing book and everything under it).
- **Safety net**: reassign any `Book` whose `userId` references a non-existent user →
  `synthmadness` (covers orphaned data).
- **Idempotent**: if a user named `synthmadness` already exists, do **not** reset its
  password on subsequent restarts. On a brand-new empty DB this simply seeds the admin
  account with no books.

### `db push` interaction

`passwordHash` is **nullable** (see schema note) so the push is a safe non-destructive
`ADD COLUMN`. `ensureAdminUser` runs immediately after the push and fills it on the one
pre-existing row before any request is served. The existing `--accept-data-loss` flag
(required for the relationship unique constraint) already covers the push; adding `@unique`
to `name` is fine because there is at most one existing user row (no duplicate to reject).

---

## 2. Server: auth, endpoints, scoping

### New dependency

- `@fastify/cookie` (pure JS). Hashing via Node built-in `node:crypto` `scrypt`.

### `server/src/auth.ts`

- `hashPassword(plain)` → `"<saltHex>:<hashHex>"` via `scryptSync`/`scrypt` with a random salt.
- `verifyPassword(plain, stored)` → constant-time compare (`crypto.timingSafeEqual`).
- Cookie config: name `rmm_session`, value = userId, **signed**, `httpOnly: true`,
  `sameSite: "lax"`, `path: "/"`, `maxAge ≈ 10 years` (the "максимально долго" requirement).
- Cookie signing secret from `SESSION_SECRET` env var; if unset, generate a random secret
  once and persist it to a file in the data volume (next to the SQLite DB) so cookies
  survive restarts. `docker-compose.yml` documents/passes `SESSION_SECRET`.

### `server/src/routes/auth.ts` (registered in `buildApp`)

- `POST /api/auth/register` — body `{ nickname, password }`.
  - Validate (see §4). Case-insensitive uniqueness check → **409** `{ error: "nickname taken" }`.
  - Create user with hashed password, **set session cookie (auto-login)**, return `{ id, name }`.
- `POST /api/auth/login` — body `{ nickname, password }`.
  - Look up by case-insensitive name; verify password. **401** on bad nickname/password.
  - Set session cookie, return `{ id, name }`.
- `GET /api/auth/me` — `{ id, name }` if the cookie resolves a user, else **401**.

No logout route.

### Auth preHandler + scoping

- A preHandler (in `buildApp`) reads/verifies the `rmm_session` cookie and resolves
  `req.user` (`{ id, name }`) or leaves it undefined.
- All `/api/books*`, `/api/characters*`, `/api/relationships*` routes **require**
  `req.user` → **401** otherwise. The `/api/auth/*` routes are exempt.
- Replace every `DEFAULT_USER_ID` use with `req.user.id`.
- `:id` routes (book graph, character ops, relationship ops) verify the target resource
  belongs to `req.user` (resolve ownership through the owning book) → **404** if not, so
  one user cannot read or mutate another's data by guessing ids.

---

## 3. Frontend: auth flow

### `AuthGate` (wraps the router in `App.tsx`)

- On mount calls `api.me()`. While pending → spinner.
- `401` → render `<AuthScreen />`. Success → render the existing `<Routes>` (Books/Book screens).
- After a successful register/login the cookie is set; `AuthGate` re-checks/re-renders into the app.

### `AuthScreen`

Two text fields — **login** and **password** — that persist unchanged across modes.

- **Register mode (default landing)**: buttons «Зарегистрироваться» and «Уже есть аккаунт».
  - «Зарегистрироваться» → `api.register` → auto-authenticated → app.
  - «Уже есть аккаунт» → switch to **login mode** (fields keep their values).
- **Login mode**: buttons «Забыли пароль?» and «Войти».
  - «Войти» → `api.login` → app.
  - «Забыли пароль?» → modal with text:
    «Для восстановления пароля обратитесь к администратору сайта, контакты указаны на
    сайте: https://mkv.qa/» (URL rendered as a clickable link). Wired via `useBackClose`
    so the system Back button closes it (consistent with other overlays).
- **Inline errors**: client-side validation messages; «Никнейм занят» on 409;
  «Неверный логин или пароль» on 401.

### `api` client (`web/src/api/client.ts`)

Add `register({ nickname, password })`, `login({ nickname, password })`, `me()`.
Cookies ride automatically (same-origin fetch); no client-side token handling.

---

## 4. Validation & config

Shared schemas (client validates for UX; server is the authority).

- **nickname**: trimmed, `min 3`, `max 20`, allowed chars EN+RU letters + digits →
  `/^[A-Za-zА-Яа-яЁё0-9]+$/`. Uniqueness and login lookup are **case-insensitive**
  (`synthmadness` == `SynthMadness`); the name is **stored as entered**. Since Prisma's
  SQLite provider has no `mode: "insensitive"`, both the register uniqueness check and
  login lookup use a raw `LOWER(name) = LOWER(:input)` query; the `@unique` index on
  `name` is a case-sensitive backstop only.
- **password**: `min 3`, `max 30`, printable non-space ASCII → `/^[\x21-\x7E]+$/`
  (covers EN letters, digits, standard symbols; no spaces).

Server schemas live in `server/src/schemas.ts` (alongside the existing zod schemas);
the web side mirrors the rules in `web/src/lib/validation.ts`.

### Config

- `SESSION_SECRET` env var (preferred). Fallback: generated-and-persisted secret file in
  the data volume. `docker-compose.yml` updated to pass `SESSION_SECRET`.

---

## 5. Testing

### Server

- `register` / `login` / `me` happy paths; error paths: 409 (nickname taken),
  401 (bad creds), validation 400.
- Password hash round-trip (`hashPassword` then `verifyPassword` true; wrong password false).
- Per-user scoping: user B cannot read/mutate user A's book/character/relationship
  (401 without cookie, 404 for cross-user id access).
- `ensureAdminUser` migration: `default-user` becomes `synthmadness` with its books
  preserved; idempotent on re-run (password not reset); fresh-DB seed creates admin.
- Update existing tests that relied on `DEFAULT_USER_ID` / unauthenticated access to
  send a session cookie.

### Web

- `AuthScreen`: register↔login mode toggle keeps field values; forgot-password modal
  shows the contact text + link; Back button closes the modal.
- `AuthGate`: 401 → `AuthScreen`, success → app; spinner while `me()` pending.

---

## Out of scope

- Password change / self-service reset (forgot-password is an informational modal only).
- Logout / account switching UI.
- Email, roles/permissions beyond per-user data isolation, rate limiting, account lockout.
- Admin password rotation flow (seed credential is fixed by request).
