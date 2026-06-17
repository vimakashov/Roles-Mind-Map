# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Roles-Mind-Map — a simple mind map for book characters (per `README.md`). Apache 2.0 licensed.

## Status

Implementation is complete and runs via Docker (all phases committed; CRUD for books and characters, mind-map canvas, PWA).

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

**Schema** (normalized SQLite): `User`, `Book`, `Character`, `Relationship`. A directed relationship edge means "source is [role] of target" (e.g. "Frodo is friend of Sam").

Data persists in the `rmm-data` Docker volume.

**Character avatars** — `web/src/lib/avatarSvg.ts` exposes `avatarSvgMarkup(gender, age)`, the single source of truth for the schematic silhouette (gender colour + age-based head radius). It is consumed two ways from the same call: the React `Avatar` component renders it via `dangerouslySetInnerHTML`, and `graphAdapter.ts` emits it as a `data:image/svg+xml,` URI (`avatarUri`) used as the Cytoscape node `background-image`. Don't re-inline the SVG geometry anywhere else.

### Gotchas (learned the hard way — keep in mind)

- **API client & bodyless requests** — `web/src/api/client.ts` only sets `Content-Type: application/json` when a body is present. Fastify rejects an empty body that declares that content-type (`FST_ERR_CTP_EMPTY_JSON_BODY` → 400), which silently breaks `DELETE`s. Don't reintroduce a blanket content-type header.
- **Mind-map canvas updates** — `web/src/canvas/MindMap.tsx` re-initialises Cytoscape only when the *set* of node/edge ids changes (add/remove). Attribute-only edits (gender, name, age, role) are synced into the existing instance in place by a second effect that spreads all mutable `data` fields (so `label`, `avatar`, `avatarUri` propagate too). Both paths are needed; editing an existing node without the sync effect would not show until reload.
- **Canvas avatar URI encoding** — the avatar SVG contains `#` hex colours, so `graphAdapter.ts` wraps it with `encodeURIComponent` before the `data:image/svg+xml,` prefix. An unencoded `#` truncates the URI (Cytoscape reads it as a fragment) and the avatar silently vanishes — keep the encoding.
- **Canvas layout spacing** — `MindMap.tsx` passes explicit `edgeLength`/`nodeSpacing` (base × `SPACING_FACTOR = 3`) to the cola layout. This affects *auto-layout only*; saved `posX`/`posY` are never scaled, so hand-placed maps keep their positions.
- **Server schema on boot** — there are no Prisma migrations; `server/src/server.ts` runs `prisma db push` at startup (idempotent). `prisma migrate deploy` is wrong here — it exits 0 without creating tables.
- **Docker** — npm workspaces hoist all deps to the **root** `node_modules` (there is no `server/node_modules`); the runtime image copies root `node_modules` and puts `/app/node_modules/.bin` on `PATH` so the `prisma` CLI is found under `node dist/server.js`. The server build needs `@types/node` (build is `tsc`, which dev/`tsx` and Vitest skip — so type errors in `server.ts` only surface in the Docker build).
- **Server tests** — `server/vitest.config.ts` sets `DATABASE_URL=file:./test.db` so the Prisma client and the schema-push agree on a throwaway DB. Without it, tests run against `dev.db` and fail on a fresh clone.

## Tooling rules

- **File navigation** — always use Serena MCP tools (`mcp__plugin_serena_serena__find_file`, `mcp__plugin_serena_serena__list_dir`, `mcp__plugin_serena_serena__find_symbol`, `mcp__plugin_serena_serena__search_for_pattern`) instead of `find`/`grep`/Bash for locating files and symbols.
- **Reading files** — prefer `mcp__plugin_serena_serena__read_file` over the Read tool or `cat`.
- **Editing code** — always use Serena MCP editing tools (`mcp__plugin_serena_serena__replace_symbol_body`, `mcp__plugin_serena_serena__insert_after_symbol`, `mcp__plugin_serena_serena__insert_before_symbol`, `mcp__plugin_serena_serena__replace_content`, `mcp__plugin_serena_serena__create_text_file`) instead of the Edit/Write tools.
- At session start, call `mcp__plugin_serena_serena__initial_instructions` before any coding task to load the Serena instructions manual.
- **Project memories** — Serena onboarding has been performed; read `mem:core` first (graph root linking `tech_stack`, `conventions`, `task_completion`, `notebooks`, etc.) via `mcp__plugin_serena_serena__read_memory` before deep work.

**Model selection:**
- Describing changes, planning, analysis, code review — use **Opus 4.8** (`claude-opus-4-8`) with **medium thinking effort**.
- Implementing changes (editing/writing files) — use **Sonnet 4.6** (`claude-sonnet-4-6`) or **Haiku 4.5** (`claude-haiku-4-5-20251001`) to minimise token spend.
