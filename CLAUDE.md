# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Roles-Mind-Map — a simple mind map for book characters (per `README.md`). Apache 2.0 licensed.

## Status

Implementation is complete and runs via Docker (all phases committed; CRUD for books and characters, mind-map canvas, custom character avatars, per-edge relationship line colours, PWA).

### Commands

```bash
# Install
npm install

# Development
npm run dev:server   # Fastify API on :3000
npm run dev:web      # Vite dev server on :5173 (proxies /api → :3000)

# Build
npm run build        # web bundle then server TypeScript compile

# Test (unit + integration, vitest)
npm test                                          # all workspaces
npm run test --workspace server -- <pattern>      # single server test
npm run test --workspace web -- <pattern>         # single web test

# End-to-end (Playwright, requires Docker)
npm run test:e2e

# Docker (production)
docker compose up --build   # app on http://localhost:3000
```

### Architecture

npm-workspaces monorepo with two packages:

- **`server/`** — Fastify 4 REST API, Prisma 5 ORM, SQLite database. Builds to `server/dist/`. In production, also serves the compiled web bundle as static files.
- **`web/`** — React 18 + TypeScript + MUI + Cytoscape.js PWA (via `vite-plugin-pwa`). Built with Vite.

**Single Docker image** (multi-stage): builds both packages, runs the Fastify server which serves the web bundle.

**Schema** (normalized SQLite): `User`, `Book`, `Character`, `Relationship`, `CharacterAvatar`. `Character.firstName` is required; `lastName` and `middleName` are both nullable (`String?`, stored as `null` when blank). A directed relationship edge means "source is [role] of target" (e.g. "Frodo is friend of Sam"); `role` is `NOT NULL` but **accepts an empty string `""`** (an unlabelled arrow), and carries an optional `color` (hex `#rrggbb`, nullable) for its canvas line; `null` renders with the default `EDGE_COLOR`. `CharacterAvatar` is a 1:1 with `Character` (shared PK `characterId`, `onDelete: Cascade`) holding the avatar bytes (`data Bytes`, `mimeType`, `width`, `height`, `updatedAt`) in a separate table so the graph query never loads blobs.

**Book rename** — a pencil icon in `TopBar` (`onEdit`, left of the trash) opens a rename dialog in `BookScreen` that PATCHes `PUT`-style `/api/books/:id` via `api.updateBook(id, title)` and refreshes. The dialog reads the current title from the graph payload (`getBookGraph` returns `{ title, nodes, edges }`; `BookGraph.title` is `title?: string` on the web side — optional only so `tsc` keeps compiling the test fixtures that omit it, the real payload always sets it).

Data persists in the `rmm-data` Docker volume.

**Character avatars** — each character shows either a *custom uploaded image* or a *schematic silhouette*.

- **Schematic (default)** — `web/src/lib/avatarSvg.ts` exposes `avatarSvgMarkup(gender, age)`, the single source of truth for the silhouette (gender colour + age-based head radius). It is consumed two ways from the same call: the React `Avatar` component renders it via `dangerouslySetInnerHTML`, and `graphAdapter.ts` emits it as a `data:image/svg+xml,` URI (`avatarUri`) used as the Cytoscape node `background-image`. Don't re-inline the SVG geometry anywhere else.
- **Custom (uploaded)** — no server-side image processing (pure-JS server preserved). The browser validates the file (`web/src/lib/avatarImage.ts`: type/size, then pixel dims via `loadImage`), the user circular-crops it (`AvatarCropDialog` + `react-easy-crop`), and `bakeToWebp` renders the crop to a **512×512 WebP** blob. Only that small blob is uploaded as base64 JSON via `api.setAvatar` to `PUT /api/characters/:id/avatar` (validated by `avatarUploadSchema`; mime literal `image/webp`, max dim, 2 MB decoded byte cap). Bytes are served from `GET /api/characters/:id/avatar` (used as both `<img src>` and the Cytoscape `background-image`) and removed via `DELETE`. The graph payload exposes only `avatarUpdatedAt` (never bytes); when set, `Avatar`/`graphAdapter.ts` build the GET URL with a `?v=<avatarUpdatedAt>` cache-bust (`api.avatarUrl`) instead of the schematic data URI. `CharacterModal` stages the change (`AvatarChange` = none/set/remove) locally and `BookScreen.submit` reconciles it after the character save (cancel discards the staging).

### Gotchas (learned the hard way — keep in mind)

- **API client & bodyless requests** — `web/src/api/client.ts` only sets `Content-Type: application/json` when a body is present. Fastify rejects an empty body that declares that content-type (`FST_ERR_CTP_EMPTY_JSON_BODY` → 400), which silently breaks `DELETE`s. Don't reintroduce a blanket content-type header.
- **Mind-map canvas updates** — `web/src/canvas/MindMap.tsx` re-initialises Cytoscape only when the *set* of node/edge ids changes (add/remove). Attribute-only edits (gender, name, age, role) are synced into the existing instance in place by a second effect that spreads all mutable `data` fields (so `label`, `avatar`, `avatarUri` propagate too). Both paths are needed; editing an existing node without the sync effect would not show until reload.
- **Canvas event handlers must read latest callbacks via refs** — because the init effect only re-runs on id-set changes, the `tap`/`dragfree` handlers bound there would otherwise capture a *stale* `onNodeTap`/`onNodeMoved` closure after an attribute-only edit. `MindMap.tsx` keeps `onNodeTapRef`/`onNodeMovedRef` updated on every render and the handlers call `*.current`. Symptom if broken: add an avatar, reopen the character without a page reload, and the modal shows the schematic (stale node had no `avatarUpdatedAt`) instead of the new avatar + «Изменить»/«Удалить» menu. Don't inline the prop directly into `cy.on(...)`. (`web/src/canvas/__tests__/MindMap.test.tsx` guards this — it forces Cytoscape's null renderer since jsdom has no 2d canvas.)
- **Canvas avatar URI encoding** — for the *schematic* branch, the avatar SVG contains `#` hex colours, so `graphAdapter.ts` wraps it with `encodeURIComponent` before the `data:image/svg+xml,` prefix. An unencoded `#` truncates the URI (Cytoscape reads it as a fragment) and the avatar silently vanishes — keep the encoding. (Custom avatars use the `GET` endpoint URL instead, so this only applies when `avatarUpdatedAt` is null.)
- **Schematic SVG needs explicit width/height for the canvas** — `avatarSvgMarkup` takes an opt-in `{ sized: true }` that adds `width="100" height="100"` (matching the `viewBox`). `graphAdapter.ts` sets it for the `data:image/svg+xml,` background-image; the React `Avatar` omits it on purpose (an outer `<svg>` defaults `width`/`height` to `100%`, so it fills its sized span). A viewBox-only SVG has *no resolvable intrinsic pixel size* as an image, so Cytoscape's `background-fit: cover` mis-positions the silhouette on browsers that don't fall back to the viewBox (seen on Chrome/Android — the avatar renders offset within the node). Keep the dimensions on the data-URI branch; don't add them to the inline path or it stops scaling to its span. (Custom avatars are raster WebP with real dimensions, so unaffected.)
- **Avatar cache-busting** — `GET /api/characters/:id/avatar` returns `Cache-Control: public, max-age=31536000, immutable`. That's safe *only because* the client always requests it with `?v=<avatarUpdatedAt>` (`api.avatarUrl`), and `CharacterAvatar.updatedAt` is `@updatedAt` so every upsert advances it; `BookScreen` re-fetches the graph after a save to pick up the new timestamp. Drop the `?v=` and an updated avatar will show stale forever.
- **Avatar upload body limit** — the `PUT` avatar route overrides Fastify's global 1 MB `bodyLimit` to 4 MB, because a ~2 MB image base64-encodes to ~2.7 MB of JSON. The real ceiling is the 2 MB *decoded* byte cap checked in the handler. Don't lower the route `bodyLimit` below the base64-expanded size of the byte cap.
- **`tsc` vs Vitest on whole-file edits** — Vitest runs via esbuild and silently ignores duplicate imports/declarations; `tsc` (the Docker/`npm run build` step) does not. When replacing a whole component file, verify there's exactly one import/interface block — a leftover duplicate passes tests but breaks the build with TS2300. Run `npx tsc --noEmit -p web/tsconfig.json` after large web edits.
- **Canvas layout spacing** — spacing constants live in `web/src/lib/layout.ts`. `MindMap.tsx` passes `edgeLength`/`nodeSpacing` (base × `SPACING_FACTOR = 5`) to the cola layout. Stored `posX`/`posY` live in the original `LAYOUT_BASELINE = 3` logical space; `graphAdapter.toElements` multiplies them by `POSITION_SCALE = SPACING_FACTOR / LAYOUT_BASELINE` (5/3) on load and `MindMap`'s `dragfree` handler divides by it before persisting. So existing hand-placed maps spread out with the factor too — keep the load/save scaling symmetric or positions drift on every drag.
- **Server schema on boot** — there are no Prisma migrations; `server/src/server.ts` runs `prisma db push` at startup (idempotent). `prisma migrate deploy` is wrong here — it exits 0 without creating tables.
- **Docker** — npm workspaces hoist all deps to the **root** `node_modules` (there is no `server/node_modules`); the runtime image copies root `node_modules` and puts `/app/node_modules/.bin` on `PATH` so the `prisma` CLI is found under `node dist/server.js`. The server build needs `@types/node` (build is `tsc`, which dev/`tsx` and Vitest skip — so type errors in `server.ts` only surface in the Docker build).
- **Server tests** — `server/vitest.config.ts` sets `DATABASE_URL=file:./test.db` so the Prisma client and the schema-push agree on a throwaway DB. Without it, tests run against `dev.db` and fail on a fresh clone.
- **Relationship colour & reconcile** — `Relationship.color` is nullable (`null` = default `EDGE_COLOR`, never written to the DB). `reconcileRelationships` keys edges by `(targetId, role)`; colour is an *attribute*, so the reconcile has a dedicated **update** branch for colour-only changes — a create/delete-only reconcile would silently drop them. The relations modal carries colour per target (`RelationEntry.targets: {id, color}[]`) and the canvas `line-color`/`target-arrow-color` fall back to `EDGE_COLOR` when an edge's `color` is null.
- **Relations wire shape is tested in two places** — the `relations` payload (`{ role, targets: {id, color}[] }`, validated by `relationEntrySchema`) is exercised by both `server/test/relationships.test.ts` (the service directly) **and** `server/test/api.test.ts` (end-to-end through the character create/update routes). When you change the shape, update *both* — a focused `relationships` test run goes green while `api.test.ts` posts the old shape and 400s. Run the **full** `npm run test --workspace server` before declaring a schema/validation change done, not just the focused file.
- **Empty role is `""`, never `NULL`** — `relationEntrySchema.role` is `z.string().trim().max(30).optional().default("")`, so an omitted/blank role stores `""`. Keep it a string: `@@unique([sourceId, targetId, role])` then still forbids a *second* unlabelled arrow per source→target pair (two `NULL`s would slip past the unique index). `reconcileRelationships` keys edges by `(targetId, role)` and the canvas renders an empty `data(label)` as a bare arrow — no extra handling needed. The «Роль» field in `RelationsModal` is marked «Необязательно».
- **Title cap is 60, name cap is 30** — `server/src/schemas.ts` has two validators: `name30` (`min(1).max(30)`) for character `firstName`/`lastName`/`middleName` and the relationship `role` max, and `title60` (`min(1).max(60)`) for `bookCreateSchema`/`bookUpdateSchema`. Both book dialogs use `inputProps={{ maxLength: 60 }}`; keep the server `title60` and the client `maxLength: 60` in sync or an over-30 rename 400s silently (the dialog swallows the error). Optional name fields use `name30.optional().nullable()`; the web client sends `lastName.trim() || null` (mirrors `middleName`).
- **Relations modal picker is a `Popper`, not a `Popover`** — `RelationsModal.tsx` uses MUI `Popper` (non-modal) for the `@uiw/react-color` wheel, anchored to the swatch. A MUI `Popover` (nested modal) marks the parent `Dialog` `aria-hidden`, which makes the "Сохранить" button unreachable to `getByRole` while the picker is open. Keep it a `Popper` + `ClickAwayListener`.
- **Back-button closes modals, not routes** — overlays call `useBackClose(open, onClose)` (`web/src/lib/useBackClose.ts`), backed by the singleton `web/src/lib/backStack.ts`. Opening pushes a throwaway history sentinel **at the same URL** (state-marker only) so react-router doesn't navigate; a real `popstate` closes the top overlay; a programmatic close drops its sentinel via a guarded `history.go`. The `guardedPops` counter + microtask-batched `reconcile` swallow self-induced echoes and collapse simultaneous closes (e.g. delete-character closes ConfirmDialog *and* CharacterModal → one `history.go(-2)`). Don't replace it with naive per-hook `popstate` listeners — those cascade-close the parent. Tests must call `__resetBackStack()` and dispatch `popstate` manually (jsdom doesn't fire it from `history.go`). `AvatarCropDialog` ignores Back while `busy` (WebP baking).

## Tooling rules

- **File navigation** — always use Serena MCP tools (`mcp__plugin_serena_serena__find_file`, `mcp__plugin_serena_serena__list_dir`, `mcp__plugin_serena_serena__find_symbol`, `mcp__plugin_serena_serena__search_for_pattern`) instead of `find`/`grep`/Bash for locating files and symbols.
- **Reading files** — prefer `mcp__plugin_serena_serena__read_file` over the Read tool or `cat`.
- **Editing code** — always use Serena MCP editing tools (`mcp__plugin_serena_serena__replace_symbol_body`, `mcp__plugin_serena_serena__insert_after_symbol`, `mcp__plugin_serena_serena__insert_before_symbol`, `mcp__plugin_serena_serena__replace_content`, `mcp__plugin_serena_serena__create_text_file`) instead of the Edit/Write tools.
- At session start, call `mcp__plugin_serena_serena__initial_instructions` before any coding task to load the Serena instructions manual.
- **Project memories** — Serena onboarding has been performed; read `mem:core` first (graph root linking `tech_stack`, `conventions`, `task_completion`, `notebooks`, etc.) via `mcp__plugin_serena_serena__read_memory` before deep work.

**Model selection:**
- Describing changes, planning, analysis, code review — use **Opus 4.8** (`claude-opus-4-8`) with **medium thinking effort**.
- Implementing changes (editing/writing files) — use **Sonnet 4.6** (`claude-sonnet-4-6`) or **Haiku 4.5** (`claude-haiku-4-5-20251001`) to minimise token spend.
