# Character Comments — Design Spec

**Date:** 2026-06-22
**Status:** Approved (pending implementation plan)

## Summary

Add a **«Комментарии (N)»** section to a character, working "по типу работы со связями":
a button in `CharacterModal` opens a modal listing the character's comments. Each
comment is a free-form text note (up to 2000 characters). Comments are **staged
locally** in the modal and persisted to the database only when the character
itself is saved (exactly like «Связи»); pressing «Отмена» on the character
discards staged comment changes. Comments are deleted via a trash icon in the
list and edited by tapping a list row.

## Decisions (resolved during brainstorming)

- **Persistence model:** staged-on-save, not immediate. Comments ride the existing
  character create/update payload, reconciled server-side in the same transaction
  as the character + relations. Works for not-yet-created characters too.
- **Text cap:** 2000 characters per comment (empty / whitespace-only rejected).
- **Graph delivery:** full comment list embedded per graph node (Approach A). A
  comment is ≤ ~2 KB, negligible next to avatar blobs (the only thing
  deliberately kept out of the graph query), so no lazy-load endpoint is needed.

## Data model & server

### Schema (`server/prisma/schema.prisma`)

New child table of `Character`:

```prisma
model Comment {
  id          String   @id @default(cuid())
  characterId String
  text        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
}
```

`Character` gains `comments Comment[]`.

- Ordered by `createdAt asc` — gives stable "1., 2., 3." numbering. No reordering
  in scope, so no `sortOrder` column.
- Pure additive table: boot-time `prisma db push` picks it up. **No
  `--accept-data-loss` concern and no `normalize` step** (those exist only because
  of the relationship unique-constraint migration).

### Wire shape & validation (`server/src/schemas.ts`)

```ts
const commentInputSchema = z.object({
  id: z.string().min(1).nullable().optional().default(null), // null = create, cuid = existing
  text: z.string().trim().min(1).max(2000),
});
```

Added to `characterCreateSchema` (and therefore `characterUpdateSchema`) as
`comments: z.array(commentInputSchema).default([])`, alongside `relations`.

### Reconcile (`server/src/services/comments.ts`)

New `reconcileComments(tx, characterId, comments)`, mirroring
`reconcileRelationships`:

- **Update** changed `text` on rows whose `id` matches an existing comment.
- **Create** the rows whose `id` is `null`.
- **Delete** the character's existing comments whose `id` is absent from the
  payload.
- All reads/writes scoped to `where: { characterId }` so ids can't cross
  characters.

Called from both character routes (`POST /api/characters`,
`PATCH /api/characters/:id`) inside the existing `$transaction`, right after
`reconcileRelationships`.

### Graph payload (`server/src/services/graph.ts`)

`getBookGraph` adds to the character query:

```ts
include: {
  avatar: { select: { updatedAt: true } },
  comments: { select: { id: true, text: true }, orderBy: { createdAt: "asc" } },
}
```

Each node carries `comments: { id, text }[]`.

## Web client & UI

### Types

- `web/src/types.ts`: `interface CommentItem { id: string | null; text: string }`;
  `Character.comments?: CommentItem[]`.
- `web/src/api/client.ts`: `CharacterInput.comments: CommentItem[]`.
  `createCharacter` / `updateCharacter` already serialize the whole input body, so
  `comments` rides along with no client API change.

### `CharacterModal`

- New `comments` state, initialised from `initial.comments`.
- A button next to «Связи»:

  ```
  Комментарии ({comments.length})
  ```

  opens `CommentsModal`. Its `onSave` calls `setComments(...)`. The badge count is
  local/staged, exactly like «Связи ({relations.length})».
- `submit` already forwards the full `CharacterInput` (now including `comments`) —
  no change to the submit signature.

### `CommentsModal` (list view)

Structured like `RelationsModal`:

- Stages a local copy of the list (`useEffect` resync on `open`).
- **Empty state:** prominent «Добавить комментарий +» button.
- **Non-empty:** a `Stack` of rows. Each row shows
  `«{i+1}. {text.trim().slice(0,15)}{…}»` on the left (ellipsis only when
  truncated) and a trash `IconButton` on the right (removes from the staged list).
  Tapping the row text opens the editor for that comment.
- A «+ Добавить комментарий» button (shown when the list is non-empty) opens the
  editor with blank text.
- Bottom actions «Отмена» / «Сохранить», matching `RelationsModal`: Save
  propagates the staged list up to `CharacterModal`; Cancel discards list-level
  edits.

### `CommentEditDialog` (editor sub-modal)

- A large multiline `TextField` (`multiline`, ~8 rows,
  `inputProps={{ maxLength: 2000 }}`).
- «Отмена» / «Сохранить»; Save disabled when the trimmed text is empty.
- On save, upserts into the staged list: an existing comment keeps its `id` (so
  the server **updates**), a new one is added as `{ id: null, text }` (so the
  server **creates**). Returns to the list view.

### Back-button handling

Both `CommentsModal` and `CommentEditDialog` wire `useBackClose(open, onClose)`,
so system Back peels editor → list → character modal, consistent with the existing
overlay stack.

### `BookScreen`

- Add `comments: modal.character.comments ?? []` to the `initial` object (next to
  `relations: incidentConnections(...)`).
- No change to `submit` — comments ride the existing
  `api.updateCharacter` / `createCharacter` body; `refresh()` re-fetches the graph
  so newly created comments come back with real ids.
- Nothing touches `graphAdapter` / `MindMap` — comments never render on the canvas.

## Testing

### Server

- `server/test/comments.test.ts` — unit-tests `reconcileComments` directly:
  create (null id), update changed text, delete-on-absence, scoping to the
  character, and the 2000-char / empty-text validation boundary.
- `server/test/api.test.ts` — extend the character create/update e2e cases to send
  `comments` and assert they return in the graph payload. (Per the existing gotcha,
  the wire shape is tested in both the service test **and** `api.test.ts`; run the
  full `npm run test --workspace server` before declaring done.)

### Web

- `CommentsModal.test.tsx` — empty state shows «Добавить комментарий +»; adding via
  the editor appends a row titled «1. …»; trash removes; tapping a row re-opens the
  editor with its text; Save propagates the staged list; Cancel discards. Call
  `__resetBackStack()` and dispatch `popstate` manually (jsdom doesn't fire it from
  `history.go`).
- `CharacterModal.test.tsx` — assert the «Комментарии (N)» button reflects the
  staged count.

### Build gate

Run `npx tsc --noEmit -p web/tsconfig.json` after the web edits (Vitest's esbuild
won't catch duplicate import/type errors that the Docker build would).

## Out of scope (YAGNI)

No comment reordering, no rich text / markdown, no per-comment timestamps in the
UI, no canvas rendering of comments, no search.
