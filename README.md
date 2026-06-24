# Roles-Mind-Map

A simple mind map for book characters.

## Production server of this project you can find at:
https://rolesmap.fyi

## Run (Docker)

```bash
docker compose up --build
# open http://localhost:3000
```

Data persists in the `rmm-data` volume.

## Develop

```bash
npm install
npm run dev:server   # API on :3000
npm run dev:web      # Vite on :5173 (proxies /api to :3000)
```

## Test

```bash
npm test             # server + web unit/integration
npm run test:e2e     # Playwright happy path (needs docker)
```

## Stack

React + MUI + Cytoscape.js (PWA) · Fastify + Prisma + SQLite · single Docker image.
See `docs/superpowers/specs/2026-06-16-roles-mind-map-design.md`.
