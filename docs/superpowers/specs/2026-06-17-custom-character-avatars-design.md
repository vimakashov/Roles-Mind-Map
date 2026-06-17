# Custom character avatars — design spec

**Date:** 2026-06-17
**Status:** Approved for planning

## Summary

Let users set a custom avatar image per character, replacing the schematic
gender/age SVG. The flow lives in the existing character settings modal
(`CharacterModal`): tapping the avatar opens a small menu — **Add** when no
avatar exists, or **Change** / **Remove** when one does. The user picks any
image file (`.jpg`, `.png`, `.gif`, `.svg`, `.webp`), then centers and scales it
inside a circular crop. The cropped result is **baked into a single static
WebP image** and stored in the database, keyed to the character. Deleting a
character (or its book) deletes the avatar via existing cascade rules.

## Decisions (locked)

- **Crop is baked into a static raster**, not stored as original + transform
  parameters. The crop cannot be re-edited later; "Change" starts fresh.
- **Animated GIF is not preserved.** A GIF is baked from its first frame; an SVG
  is rasterized. (User explicitly chose baking over animation support.)
- **Image processing happens in the browser** (Approach A). All user-facing
  limits are enforced client-side before baking; the server only stores the
  small baked blob and applies a defense-in-depth cap. No native image library
  (`sharp` etc.) is added to the server — this preserves the pure-JS server and
  the simple Docker build.
- **Avatar bytes live in a separate one-to-one table**, not a column on
  `Character`, so the graph query never drags blobs over the wire.
- **`react-easy-crop`** is the one new web dependency, used for the circular
  drag/zoom crop UI.

### Accepted constraints

| Constraint | Value | Enforced |
|---|---|---|
| Accepted input types | jpg, png, gif, svg, webp | client (`accept` + validation), server (baked type allowlist) |
| Max file size | 15 MB | client (original file) |
| Min dimensions | 64 × 64 px | client (raster only) |
| Max dimensions | 3000 × 3000 px | client (raster only) |
| Baked output | 512 × 512 WebP | client produces, server verifies |
| Server payload cap | ~2 MB decoded | server |

SVG has no reliable intrinsic pixel size, so the 64–3000 dimension check is
skipped for SVG; it is rasterized directly into the crop canvas. The 15 MB file
cap still applies to the SVG file.

## Data model

New one-to-one table; `Character` gains an optional back-relation.

```prisma
model CharacterAvatar {
  characterId String    @id
  data        Bytes     // baked WebP bytes
  mimeType    String    // 'image/webp'
  width       Int       // 512
  height      Int       // 512
  updatedAt   DateTime  @updatedAt
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
}

// On Character:
//   avatar CharacterAvatar?
```

Cascade behavior:
- Delete a character → its `CharacterAvatar` row is deleted (`onDelete: Cascade`).
- Delete a book → characters cascade-delete → avatars cascade-delete.

The schema is applied by the existing `prisma db push` at server startup
(`server/src/server.ts`). There are no migrations. `prisma migrate deploy` must
not be introduced — it exits 0 without creating tables here.

## Server API

All endpoints sit alongside the existing character routes
(`server/src/routes/characters.ts`). Validation schemas go in
`server/src/schemas.ts`.

### `GET /api/characters/:id/avatar`
- Returns the raw image bytes with `Content-Type: <mimeType>` and a
  `Cache-Control` header.
- `404` if the character has no avatar.
- Used both as an `<img src>` in the web UI and as the Cytoscape node
  `background-image`.

### `PUT /api/characters/:id/avatar`
- Body (JSON): `{ data: <base64 string>, mimeType: string, width: number, height: number }`.
  JSON (not multipart/raw-binary) keeps the existing JSON-only client and avoids
  adding a content-type parser; the baked payload is small enough that base64
  overhead is negligible.
- Server validation (defense in depth):
  - `mimeType` ∈ { `image/webp` }
  - decoded byte length ≤ ~2 MB
  - `width` ≤ 1024 and `height` ≤ 1024
- `upsert` the `CharacterAvatar` row (insert or replace).
- `404` if the character does not exist; `400` on validation failure.

### `DELETE /api/characters/:id/avatar`
- Deletes the `CharacterAvatar` row; returns `204`.
- Bodyless DELETE — the web client already omits `Content-Type` on bodyless
  requests, so this is safe.

### Graph payload
`getBookGraph` (`server/src/services/graph.ts`) adds
`include: { avatar: { select: { updatedAt: true } } }` to the character query —
this fetches only the timestamp, never the bytes. Each graph node exposes
`avatarUpdatedAt: string | null`. The `Character` type
(`web/src/types.ts`) gains `avatarUpdatedAt?: string | null`.

## Client image pipeline

New module `web/src/lib/avatarImage.ts`:

- `validateAvatarFile(file): { ok: true } | { ok: false; error: string }`
  - type ∈ { image/jpeg, image/png, image/gif, image/svg+xml, image/webp }
  - size ≤ 15 MB
  - for raster types: load into `Image`, assert natural dimensions within
    64×64 … 3000×3000
  - for SVG: skip dimension check (rasterized later)
- `bakeAvatar(image, cropState): Promise<Blob>`
  - draws the selected circular region into a 512×512 `<canvas>`
  - exports via `canvas.toBlob('image/webp', quality)`
  - animated GIF → first frame; SVG → rasterized

## UI

All changes are inside `CharacterModal` (`web/src/components/CharacterModal.tsx`)
plus a new `AvatarCropDialog` component.

### Avatar menu
- Tapping the avatar opens a MUI menu/popover anchored to it.
- No avatar → single **Add** action.
- Has avatar → **Change** and **Remove** actions.
- A hidden `<input type="file" accept="image/jpeg,image/png,image/gif,image/svg+xml,image/webp">`
  triggers the system picker.

### Crop dialog
- New `AvatarCropDialog` using `react-easy-crop`.
- Circular crop: drag to center, slider to scale.
- "Save" bakes the visible circle to a Blob (via `bakeAvatar`) and returns it;
  "Cancel" discards.

### Staging (consistent with the rest of the form)
The modal holds pending avatar intent:

```ts
type AvatarChange =
  | { kind: "none" }
  | { kind: "set"; blob: Blob }
  | { kind: "remove" };
```

- Preview precedence in the modal: pending `set` blob → existing custom avatar
  (via endpoint URL) → schematic SVG fallback.
- Changes apply only when the modal's **Save** is pressed; **Cancel** discards
  them — matching the existing all-or-nothing form behavior.
- `CharacterModal`'s `onSubmit` is widened to `(input, avatarChange)`.
- `BookScreen.submit` reconciles after create/update (both return a `Character`
  with `id`):
  - `set` → `api.setAvatar(id, blob)`
  - `remove` → `api.deleteAvatar(id)`
  - `none` → no-op
  - Works for both create (id available after POST) and edit.

## Rendering

### Avatar component (`web/src/components/Avatar.tsx`)
- Accepts an optional `src`. When provided, renders an `<img>` masked with
  `border-radius: 50%`. Otherwise renders the existing schematic SVG.

### Canvas (`web/src/lib/graphAdapter.ts`)
- When `avatarUpdatedAt != null`, set `avatarUri` to the endpoint URL
  `/api/characters/:id/avatar?v=<avatarUpdatedAt>` (the version query param busts
  the cache after a change). Otherwise keep the schematic `data:image/svg+xml,…`
  URI as today.
- No changes to `MindMap.tsx`: nodes are already ellipses with
  `background-fit: cover` consuming `data(avatarUri)`, so a baked square image
  displays as a circle. The existing in-place sync effect already propagates
  `avatarUri`, so edits appear without reload.
- Keep the `encodeURIComponent` wrapping for the schematic data-URI path
  (unencoded `#` truncates the URI).

### API client (`web/src/api/client.ts`)
- `setAvatar(id, blob)` — Blob → base64 → `PUT` JSON body.
- `deleteAvatar(id)` — `DELETE` (bodyless).
- `avatarUrl(id, version)` helper for `<img src>` / canvas.
- Preserve the rule: set `Content-Type: application/json` only when a body is
  present.

## Testing

### Server (vitest)
- `PUT` validation: rejects bad `mimeType`, oversized payload, oversized
  dimensions; accepts valid WebP.
- `GET`: returns bytes with correct content-type; `404` when absent.
- `DELETE`: returns `204` and removes the row.
- Cascade: deleting a character removes its avatar; deleting a book removes
  characters and their avatars.
- Graph: returns `avatarUpdatedAt` and never includes avatar bytes.

### Web (vitest)
- `validateAvatarFile`: type allowlist, 15 MB cap, dimension bounds incl.
  boundaries (64, 3000), SVG path skips dimension check.
- `bakeAvatar`: output is 512×512 `image/webp`.
- `graphAdapter`: emits endpoint URL when `avatarUpdatedAt` set, schematic URI
  otherwise.
- `CharacterModal`: menu states (Add vs Change/Remove), staging of set / remove
  / cancel, preview precedence.
- `Avatar`: renders `<img>` when `src` given, SVG otherwise.

### E2E (Playwright, optional)
- Add → crop → save → avatar appears on canvas; Remove → reverts to schematic.

## Out of scope

- Re-editable crop (the baked image is final; Change re-uploads).
- Preserving GIF animation or vector SVG (both are rasterized).
- Server-side image processing / validation of the original file.
- Multiple avatars or avatar history per character.
