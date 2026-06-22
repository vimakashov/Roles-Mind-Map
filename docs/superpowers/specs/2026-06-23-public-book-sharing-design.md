# Public Read-Only Book Sharing — Design

**Date:** 2026-06-23
**Status:** Approved (pending implementation plan)

## Summary

Add the ability to share a book's mind-map canvas via a permanent public link.
Inside a book, a **share** icon appears in the top bar (left of the edit pencil).
Tapping it copies a link to the clipboard and shows a success toast. The link
opens a **read-only** view of the book's canvas that anyone can see without
registering or logging in. The recipient can pan/zoom the canvas and open each
character to view its fields, relationships, and comments — all read-only. No
editing, adding, or deleting of anything (book, characters, relationships,
comments, avatars).

## Locked-in decisions

- **The link identifies the book by its `id`.** URL form: `<origin>/share/<bookId>`.
  No new schema column and **no migration**: the link is derived from the
  always-present `Book.id`, so it implicitly exists the moment a book is created
  and for every existing book. (The original idea of a generated token column +
  recursive backfill migration is unnecessary given this choice.)
- **A separate `ShareScreen`** reuses the existing `MindMap` canvas. The heavy,
  stateful editable `CharacterModal` is left untouched.
- **The read-only character card is a separate lightweight component**
  (`CharacterView`), not the edit modal with disabled fields.
- **A single MUI `Snackbar`** provides the "link copied" toast (none exists today).

## Architecture

### 1. Server — public, unauthenticated endpoints

New `server/src/routes/share.ts`, registered in `app.ts`. One change to the
auth-gate `preHandler` in `app.ts`: exempt `/api/share/` exactly like
`/api/auth/`, so these routes need no `rmm_session` cookie and perform no
ownership check.

Endpoints:

- `GET /api/share/:bookId/graph`
  - Returns the **same payload** as the existing `getBookGraph(bookId)` service
    (`{ title, nodes, edges }`, with comments and `avatarUpdatedAt` already
    embedded per node).
  - Book does not exist → `404`.
- `GET /api/share/:bookId/characters/:characterId/avatar`
  - Serves the avatar bytes, **scoped to the book**: verify the character
    belongs to `:bookId`; otherwise `404`.
  - Same response headers as the private route:
    `Cache-Control: public, max-age=31536000, immutable`, correct `mimeType`.
  - No avatar row → `404`.

Rationale for a book-scoped avatar route (instead of making
`/api/characters/:id/avatar` public): keeps the entire public surface
consolidated under `/api/share/*` and avoids exposing arbitrary avatars by bare
character id.

The existing global error handler in `app.ts` maps Prisma `P2025` to `404`; the
share routes can rely on it or check existence explicitly (consistent with the
existing routes).

### 2. Web — routing & the read-only screen

`web/src/App.tsx`: add a route **outside** `<AuthGate>` (no login required):

```tsx
<Route path="/share/:bookId" element={<ShareScreen />} />
```

The existing authed routes (`/`, `/books/:bookId`) stay **inside** the gate.

New `web/src/screens/ShareScreen.tsx`:

- Fetches the graph via a new client method `api.getSharedGraph(bookId)` that
  hits `GET /api/share/:bookId/graph`.
- Renders `TopBar` with **only the title** — no `onBack`, `onEdit`, `onDelete`,
  or `onShare`. The existing `TopBar` already hides each icon when its handler
  prop is absent, so no `TopBar` change is needed for the read-only view.
- Renders `MindMap` with `onNodeTap` opening the read-only `CharacterView`, and
  **no** `onEdgeTap`, **no** `onNodeMoved`, and **no** `AddFab`.
- Invalid / deleted `bookId` (fetch fails / 404) → a simple
  "Ссылка недействительна" message.

### 3. Web — avatar URLs in the reused canvas

`graphAdapter.toElements` and `CharacterModal` currently hardcode
`api.avatarUrl` (which builds `/api/characters/:id/avatar?v=...`). For the public
view, avatar URLs must point at the book-scoped public route.

- Parameterize `toElements(graph, opts?)` with an optional avatar-URL builder:
  `toElements(graph, { avatarUrl } = { avatarUrl: api.avatarUrl })`.
- Thread an optional `avatarUrl` builder prop through `MindMap` (forwarded to
  `toElements`). Default is the existing `api.avatarUrl`, so the authed
  `BookScreen` is unchanged.
- `ShareScreen` passes a builder that targets
  `/api/share/:bookId/characters/:id/avatar?v=...` (a new
  `api.sharedAvatarUrl(bookId, id, version)` client helper).

### 4. Web — read-only character card

New `web/src/components/CharacterView.tsx` — a `Dialog` that displays:

- Avatar (custom or schematic) with the deceased veil/X overlay when applicable.
- Plain read-only rows: gender, full name, age.
- A read-only relationships list (other character's name + role), with name
  resolution from the already-fetched graph nodes.
- A read-only comments list.

No text fields, no save/delete/add buttons, no avatar menu, no relations/comments
editing dialogs. Relationships and comments are rendered directly from the graph
payload already fetched by `ShareScreen` — no additional requests.

The card wires `useBackClose(open, onClose)` so the system Back button closes it,
consistent with the rest of the app's overlays.

### 5. Web — share button + toast on `BookScreen` (the owner's view)

- `TopBar` gains an optional `onShare?: () => void` prop rendering a `ShareIcon`
  **left of** the edit pencil, inside the existing right-hand icon box (widen the
  box from 96px as needed to fit three icons without truncating the title).
- `BookScreen` passes `onShare` that:
  - builds `${window.location.origin}/share/${bookId}`,
  - writes it to the clipboard via `navigator.clipboard.writeText(...)`,
  - shows a success `Snackbar` ("Ссылка скопирована").

## Data flow

1. Owner opens a book → `BookScreen` (authed) → taps share → URL copied + toast.
2. Recipient opens `/share/:bookId` → `ShareScreen` (no auth) →
   `GET /api/share/:bookId/graph` → renders `MindMap`.
3. Recipient taps a node → `CharacterView` opens, rendering that character's
   fields/relations/comments from the already-fetched graph.
4. Avatars on the public canvas/card load from
   `GET /api/share/:bookId/characters/:id/avatar?v=<avatarUpdatedAt>`.

## What stays unchanged

- Prisma schema (no new columns, no migration).
- The editable `CharacterModal`, `RelationsModal`, `CommentsModal`,
  `RelationEditModal`, and the authed data routes.
- `getBookGraph` service (reused as-is by the public graph route).
- The auth gate for every non-`/api/share/` `/api/*` route (still 401s anonymous
  requests).

## Error handling

- Public graph for a missing book → `404` → `ShareScreen` shows
  "Ссылка недействительна".
- Public avatar for a character not in the book, or with no avatar row → `404`
  (the canvas/card falls back to the schematic, same as the authed path when an
  avatar 404s).
- Clipboard write failure → the toast logic should handle a rejected
  `writeText` gracefully (no crash; optionally an error toast).

## Testing

### Server (`server/test/share.test.ts`)

- `GET /api/share/:bookId/graph` returns the graph **without a cookie**.
- `GET /api/share/:bookId/characters/:id/avatar` returns bytes without a cookie.
- Unknown `bookId` → `404`; avatar for a character not in that book → `404`.
- The auth gate still `401`s a non-share `/api/*` request made anonymously
  (regression guard for the `preHandler` exemption).

### Web

- `graphAdapter` honours a custom `avatarUrl` builder (default unchanged).
- `ShareScreen` renders the canvas with **no** `AddFab` and **no** edit
  affordances, and opens `CharacterView` on node tap.
- `CharacterView` renders fields/relations/comments read-only (no inputs, no
  save/delete buttons).
- `TopBar` shows the share icon only when `onShare` is provided, and does not
  render it on `ShareScreen`.
- `BookScreen` share click writes the expected URL to the clipboard and shows
  the toast.

## Out of scope (YAGNI)

- Link revocation / regeneration / expiry.
- A separate share token column or backfill migration.
- Per-share access controls, view counts, or analytics.
- Any write capability in the public view.
