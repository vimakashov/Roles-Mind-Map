# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Roles-Mind-Map — a simple mind map for book characters (per `README.md`). Apache 2.0 licensed.

## Status

Implementation is complete (Phases 0–5 committed).

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

## Tooling rules

- **File navigation** — always use Serena MCP tools (`mcp__plugin_serena_serena__find_file`, `mcp__plugin_serena_serena__list_dir`, `mcp__plugin_serena_serena__find_symbol`, `mcp__plugin_serena_serena__search_for_pattern`) instead of `find`/`grep`/Bash for locating files and symbols.
- **Reading files** — prefer `mcp__plugin_serena_serena__read_file` over the Read tool or `cat`.
- **Editing code** — always use Serena MCP editing tools (`mcp__plugin_serena_serena__replace_symbol_body`, `mcp__plugin_serena_serena__insert_after_symbol`, `mcp__plugin_serena_serena__insert_before_symbol`, `mcp__plugin_serena_serena__replace_content`, `mcp__plugin_serena_serena__create_text_file`) instead of the Edit/Write tools.
- At session start, call `mcp__plugin_serena_serena__initial_instructions` before any coding task to load the Serena instructions manual.
- **Project memories** — Serena onboarding has been performed; read `mem:core` first (graph root linking `tech_stack`, `conventions`, `task_completion`, `notebooks`, etc.) via `mcp__plugin_serena_serena__read_memory` before deep work.

**Model selection:**
- Describing changes, planning, analysis, code review — use **Opus 4.8** (`claude-opus-4-8`) with **medium thinking effort**.
- Implementing changes (editing/writing files) — use **Sonnet 4.6** (`claude-sonnet-4-6`) or **Haiku 4.5** (`claude-haiku-4-5-20251001`) to minimise token spend.
