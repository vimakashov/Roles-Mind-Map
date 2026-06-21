# Deceased Character Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a character be marked «Умер» via a checkbox in the character modal; when set, a black X plus a dimming veil is drawn over the character's avatar both on the mind-map canvas and in the modal preview.

**Architecture:** One new boolean column `Character.deceased` threads through the existing server spreads (`...fields` in routes, `...c` in the graph service). The X+veil overlay is a single standalone SVG (`deceasedOverlaySvg`, sibling of `avatarSvgMarkup`) used in two render paths: an absolutely-positioned layer in the React `Avatar`, and a second Cytoscape layered `background-image` on the canvas node (emitted by `graphAdapter` as `overlayUri`, consumed by a `MindMap` style mapper).

**Tech Stack:** Fastify 4 + Prisma 5 (SQLite) server; React 18 + TypeScript + MUI + Cytoscape.js web; Vitest + Testing Library; Zod validation.

## Global Constraints

- Field name is `deceased` (boolean), `@default(false)`, never nullable.
- The overlay is **one SVG** = translucent grey veil circle + black X (light halo), carrying a unique `data-overlay="deceased"` marker; it is the single source of truth for both render paths. Do not re-inline the X geometry anywhere else.
- `graphAdapter` always sets `overlayUri` explicitly to `null` when not deceased (never omits the key) so the `MindMap` in-place `data()` merge clears a stale overlay when a character is un-marked.
- Schematic SVG data URIs are wrapped with `encodeURIComponent` after the `data:image/svg+xml,` prefix (an unencoded `#` truncates the URI). The overlay URI follows the same rule.
- Sized SVG variant (`{ sized: true }`) adds explicit `width="100" height="100"`; used only for the canvas data URI, never for the inline React layer.
- UI copy: checkbox label is exactly «Умер».
- Run the **full** `npm run test --workspace server` (not a focused file) before declaring the server change done; web changes verify with `npx tsc --noEmit -p web/tsconfig.json` after large edits.

---

### Task 1: Server — `deceased` column, schema, and API tests

**Files:**
- Modify: `server/prisma/schema.prisma` (Character model)
- Modify: `server/src/schemas.ts` (characterCreateSchema)
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Character.deceased: boolean` present on every character row and in the `/api/books/:id/graph` node payload; accepted (optional, default `false`) by `POST /api/characters` and `PATCH /api/characters/:id`.

- [ ] **Step 1: Write the failing tests**

Add these two tests at the end of `server/test/api.test.ts`:

```ts
test("persists the deceased flag on create and exposes it in the graph", async () => {
  const book = await createBook();
  const res = await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "Boris", lastName: "B", deceased: true, relations: [] },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().deceased).toBe(true);

  const graph = (await app.inject({ method: "GET", url: `/api/books/${book.id}/graph` })).json();
  expect(graph.nodes[0].deceased).toBe(true);
});

test("defaults deceased to false when omitted and toggles via PATCH", async () => {
  const book = await createBook();
  const c = (await app.inject({
    method: "POST", url: "/api/characters",
    payload: { bookId: book.id, gender: "male", firstName: "Ivan", lastName: "I", relations: [] },
  })).json();
  expect(c.deceased).toBe(false);

  const patched = await app.inject({
    method: "PATCH", url: `/api/characters/${c.id}`,
    payload: { gender: "male", firstName: "Ivan", lastName: "I", deceased: true, relations: [] },
  });
  expect(patched.statusCode).toBe(200);
  expect(patched.json().deceased).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace server -- api.test`
Expected: FAIL — the new tests get `undefined` for `deceased` (Zod strips the unknown key; the column does not exist yet).

- [ ] **Step 3: Add the column to the Prisma schema**

In `server/prisma/schema.prisma`, add the field to the `Character` model immediately after the `age` line:

```prisma
  age        Int?
  deceased   Boolean  @default(false)
  posX       Float?
```

- [ ] **Step 4: Add `deceased` to the create schema**

In `server/src/schemas.ts`, add the field inside `characterCreateSchema` (after `age`). `characterUpdateSchema` inherits it via `.omit({ bookId: true })`, so no second edit:

```ts
  age: z.number().int().min(0).max(100).optional().nullable(),
  deceased: z.boolean().optional().default(false),
  relations: z.array(relationConnectionSchema).default([]),
```

- [ ] **Step 5: Regenerate the Prisma client**

The generated client is what carries the new typed column to `prisma.character.create/update`.

Run: `npx prisma generate --schema server/prisma/schema.prisma`
Expected: `Generated Prisma Client` success message.

- [ ] **Step 6: Run the full server suite to verify it passes**

The test DB is rebuilt from the schema by `setupTestDb` (`prisma db push --force-reset`), so the new column is created automatically.

Run: `npm run test --workspace server`
Expected: PASS — all tests, including the two new ones.

- [ ] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/src/schemas.ts server/test/api.test.ts
git commit -m "feat(server): add Character.deceased flag (create/update/graph)"
```

---

### Task 2: Web — `deceasedOverlaySvg` single source of truth

**Files:**
- Modify: `web/src/lib/avatarSvg.ts`
- Test: `web/src/lib/__tests__/avatarSvg.test.ts`

**Interfaces:**
- Consumes: nothing from earlier web tasks.
- Produces: `deceasedOverlaySvg(opts?: { sized?: boolean }): string` — a standalone `<svg viewBox="0 0 100 100">` with `xmlns`, a `data-overlay="deceased"` marker, a translucent grey veil `<circle>`, and a black X `<path>`/`<line>`s with a light halo. `sized` adds `width="100" height="100"`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/__tests__/avatarSvg.test.ts`:

```ts
import { deceasedOverlaySvg } from "../avatarSvg.js";

test("overlay is a standalone svg carrying the deceased marker", () => {
  const svg = deceasedOverlaySvg();
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('data-overlay="deceased"');
});

test("overlay contains a veil circle and a black X stroke", () => {
  const svg = deceasedOverlaySvg();
  expect(svg).toContain("<circle"); // dimming veil
  expect(svg.toLowerCase()).toContain("#111"); // X stroke colour
});

test("overlay omits explicit width/height by default, includes them when sized", () => {
  expect(deceasedOverlaySvg()).not.toContain("width=");
  expect(deceasedOverlaySvg({ sized: true })).toContain('width="100"');
  expect(deceasedOverlaySvg({ sized: true })).toContain('height="100"');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- avatarSvg`
Expected: FAIL — `deceasedOverlaySvg` is not exported.

- [ ] **Step 3: Implement `deceasedOverlaySvg`**

Append to `web/src/lib/avatarSvg.ts` (after `avatarSvgMarkup`):

```ts
// Single source of truth for the "deceased" overlay drawn over an avatar:
// a translucent grey veil (the dimming) plus a black X with a light halo,
// inscribed in the avatar circle. Used both as a React inline layer and as a
// `data:image/svg+xml,` background-image on the canvas (hence the explicit
// xmlns and the opt-in `sized` width/height; see avatarSvgMarkup for why a
// viewBox-only SVG needs explicit dimensions as a background-image).
export function deceasedOverlaySvg(opts?: { sized?: boolean }): string {
  const size = opts?.sized ? `width="100" height="100" ` : "";
  // Halo first (wider, light), then the black X on top; same two diagonals.
  const x =
    `<path d="M28 28 L72 72 M72 28 L28 72" fill="none" ` +
    `stroke="#ffffff" stroke-width="14" stroke-linecap="round" opacity="0.9"/>` +
    `<path d="M28 28 L72 72 M72 28 L28 72" fill="none" ` +
    `stroke="#111111" stroke-width="9" stroke-linecap="round"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-overlay="deceased" ` +
    `${size}viewBox="0 0 100 100" role="img" aria-label="умер">` +
    `<circle cx="50" cy="50" r="48" fill="rgba(120,120,120,0.35)"/>` +
    x +
    `</svg>`
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace web -- avatarSvg`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/avatarSvg.ts web/src/lib/__tests__/avatarSvg.test.ts
git commit -m "feat(web): add deceasedOverlaySvg (veil + X overlay)"
```

---

### Task 3: Web — `Avatar` renders the overlay when deceased

**Files:**
- Modify: `web/src/components/Avatar.tsx`
- Test: `web/src/components/__tests__/Avatar.test.tsx`

**Interfaces:**
- Consumes: `deceasedOverlaySvg` (Task 2).
- Produces: `Avatar` accepts a new prop `deceased?: boolean`; when true it renders a `data-testid="avatar-deceased"` overlay span (`deceasedOverlaySvg()` via `dangerouslySetInnerHTML`) absolutely positioned over the existing avatar, for both the `<img>` and schematic branches.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/components/__tests__/Avatar.test.tsx`:

```ts
test("draws the deceased overlay over a schematic avatar", () => {
  render(<Avatar gender="male" age={30} deceased />);
  expect(screen.getByTestId("avatar-deceased")).toBeInTheDocument();
});

test("draws the deceased overlay over a custom avatar image", () => {
  render(<Avatar gender="male" age={30} src="/api/characters/c1/avatar?v=1" deceased />);
  expect(screen.getByTestId("avatar-img")).toBeInTheDocument();
  expect(screen.getByTestId("avatar-deceased")).toBeInTheDocument();
});

test("no overlay when not deceased", () => {
  render(<Avatar gender="male" age={30} />);
  expect(screen.queryByTestId("avatar-deceased")).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- Avatar.test`
Expected: FAIL — `deceased` prop is ignored; no `avatar-deceased` element.

- [ ] **Step 3: Implement the overlay layer**

Replace the body of `web/src/components/Avatar.tsx` with:

```tsx
import type { Gender } from "../types.js";
import { avatarKey } from "../lib/avatar.js";
import { avatarSvgMarkup, deceasedOverlaySvg } from "../lib/avatarSvg.js";

interface Props {
  gender: Gender;
  age?: number | null;
  size?: number;
  src?: string | null;
  deceased?: boolean;
}

export function Avatar({ gender, age, size = 56, src, deceased }: Props) {
  const inner = src ? (
    <img
      data-testid="avatar-img"
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  ) : (
    <span
      data-testid="avatar"
      data-avatar={avatarKey(gender, age)}
      aria-label={avatarKey(gender, age)}
      style={{ display: "block", width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: avatarSvgMarkup(gender, age) }}
    />
  );

  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, lineHeight: 0 }}>
      {inner}
      {deceased && (
        <span
          data-testid="avatar-deceased"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, lineHeight: 0 }}
          dangerouslySetInnerHTML={{ __html: deceasedOverlaySvg() }}
        />
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace web -- Avatar.test`
Expected: PASS (all three new tests plus the two existing ones).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Avatar.tsx web/src/components/__tests__/Avatar.test.tsx
git commit -m "feat(web): Avatar draws deceased X overlay when marked"
```

---

### Task 4: Web — `graphAdapter` emits `overlayUri`; `Character` type gains `deceased`

**Files:**
- Modify: `web/src/types.ts` (Character)
- Modify: `web/src/lib/graphAdapter.ts`
- Test: `web/src/lib/__tests__/graphAdapter.test.ts`

**Interfaces:**
- Consumes: `deceasedOverlaySvg` (Task 2); `Character.deceased` (this task adds it to the type).
- Produces: every node element's `data.overlayUri` is the encoded `data:image/svg+xml,` overlay URI when `deceased`, else `null`. `Character.deceased?: boolean` exists on the web type.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/__tests__/graphAdapter.test.ts`:

```ts
test("deceased node carries an encoded overlay data URI", () => {
  const g: BookGraph = {
    nodes: [{ id: "d", bookId: "b", gender: "male", firstName: "Х", lastName: "Х", deceased: true }],
    edges: [],
  };
  const node = toElements(g)[0];
  expect(node.data.overlayUri as string).toContain("data:image/svg+xml,");
  expect(node.data.overlayUri as string).toContain("deceased");
});

test("living node has a null overlay (so the canvas clears a stale overlay)", () => {
  const g: BookGraph = {
    nodes: [{ id: "a", bookId: "b", gender: "male", firstName: "Х", lastName: "Х" }],
    edges: [],
  };
  expect(toElements(g)[0].data.overlayUri).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — `overlayUri` is `undefined` (not produced yet).

- [ ] **Step 3: Add `deceased` to the web `Character` type**

In `web/src/types.ts`, add the field to the `Character` interface (after `avatarUpdatedAt`):

```ts
  avatarUpdatedAt?: string | null;
  deceased?: boolean;
}
```

- [ ] **Step 4: Emit `overlayUri` from the node mapper**

In `web/src/lib/graphAdapter.ts`, import `deceasedOverlaySvg` and add `overlayUri` to the node `data`. Update the import line and the `data` object:

```ts
import { avatarSvgMarkup, deceasedOverlaySvg } from "./avatarSvg.js";
```

```ts
      data: {
        id: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join("\n"),
        avatar: avatarKey(c.gender, c.age),
        avatarUri: c.avatarUpdatedAt
          ? api.avatarUrl(c.id, c.avatarUpdatedAt)
          : "data:image/svg+xml," + encodeURIComponent(avatarSvgMarkup(c.gender, c.age, { sized: true })),
        overlayUri: c.deceased
          ? "data:image/svg+xml," + encodeURIComponent(deceasedOverlaySvg({ sized: true }))
          : null,
        gender: c.gender,
      },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/lib/graphAdapter.ts web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): graphAdapter emits deceased overlayUri (null when alive)"
```

---

### Task 5: Web — `MindMap` layers the overlay as a second background image

**Files:**
- Modify: `web/src/canvas/MindMap.tsx`
- Test: `web/src/canvas/__tests__/MindMap.test.tsx`

**Interfaces:**
- Consumes: node `data.overlayUri` (Task 4).
- Produces: the node `background-image` style is `[avatarUri, overlayUri]` when `overlayUri` is truthy, else `avatarUri`; `background-fit` matches arity. No new exported symbols.

- [ ] **Step 1: Write the failing test**

Append to `web/src/canvas/__tests__/MindMap.test.tsx`:

```ts
test("a deceased node layers the overlay into its background-image", () => {
  const graph: BookGraph = {
    nodes: [
      { id: "dead", bookId: "b1", gender: "male", firstName: "A", lastName: "X", deceased: true },
      { id: "alive", bookId: "b1", gender: "female", firstName: "B", lastName: "Y" },
    ],
    edges: [],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} />);
  const cy = instances[0];
  expect(String(cy.getElementById("dead").style("background-image"))).toContain("deceased");
  expect(String(cy.getElementById("alive").style("background-image"))).not.toContain("deceased");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- MindMap`
Expected: FAIL — `background-image` is still the single `data(avatarUri)` mapper, so the dead node's value has no `deceased` token.

- [ ] **Step 3: Make `background-image` a layered mapper**

In `web/src/canvas/MindMap.tsx`, inside the `node` style block, replace the `"background-image"` and `"background-fit"` lines:

```ts
            "background-image": (ele: any) =>
              ele.data("overlayUri")
                ? [ele.data("avatarUri"), ele.data("overlayUri")]
                : ele.data("avatarUri"),
            "background-fit": (ele: any) => (ele.data("overlayUri") ? ["cover", "cover"] : "cover"),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- MindMap`
Expected: PASS (the new test plus the two existing MindMap tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/canvas/MindMap.tsx web/src/canvas/__tests__/MindMap.test.tsx
git commit -m "feat(web): canvas layers deceased overlay over the avatar"
```

---

### Task 6: Web — «Умер» checkbox in `CharacterModal`, wired through the input

**Files:**
- Modify: `web/src/api/client.ts` (CharacterInput)
- Modify: `web/src/screens/BookScreen.tsx` (initial mapping)
- Modify: `web/src/components/CharacterModal.tsx`
- Test: `web/src/components/__tests__/CharacterModal.test.tsx`

**Interfaces:**
- Consumes: `Avatar` `deceased` prop (Task 3); `CharacterInput` carries `deceased` end-to-end (the server already accepts it — Task 1).
- Produces: a `Checkbox`/`FormControlLabel` «Умер» in the modal; `onSubmit`'s input object includes `deceased: boolean`; the modal's avatar preview reflects the staged checkbox live.

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/__tests__/CharacterModal.test.tsx`:

```ts
test("toggling «Умер» submits deceased: true", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", relations: [] }}
      onCancel={() => {}} onSubmit={onSubmit} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByLabelText(/умер/i));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ deceased: true }),
    { kind: "none" },
  );
});

test("defaults deceased to false when the box is left unchecked", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", relations: [] }}
      onCancel={() => {}} onSubmit={onSubmit} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ deceased: false }),
    { kind: "none" },
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- CharacterModal`
Expected: FAIL — there is no «Умер» control and `deceased` is not in the submitted object.

- [ ] **Step 3: Add `deceased` to `CharacterInput`**

In `web/src/api/client.ts`, add to the `CharacterInput` interface (after `age`):

```ts
  age?: number | null;
  deceased: boolean;
  relations: RelationConnection[];
```

- [ ] **Step 4: Map `deceased` into `initial` in `BookScreen`**

In `web/src/screens/BookScreen.tsx`, add to the `initial` object (after `age`):

```ts
    age: modal.character.age ?? null,
    deceased: modal.character.deceased ?? false,
    relations: incidentConnections(modal.character.id, graph.edges),
```

- [ ] **Step 5: Wire the checkbox into `CharacterModal`**

In `web/src/components/CharacterModal.tsx`:

(a) Extend the MUI import to include `Checkbox` and `FormControlLabel`:

```ts
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  MenuItem, Stack, Box, IconButton, Menu, Checkbox, FormControlLabel,
} from "@mui/material";
```

(b) Add the `empty` default's `deceased` so the fallback input is well-typed — replace the `empty` const:

```ts
const empty: CharacterInput = {
  gender: "male", firstName: "", lastName: "", middleName: "", age: null, deceased: false, relations: [],
};
```

(c) Add state next to the other field state (after the `age` state line):

```ts
  const [deceased, setDeceased] = useState(initial?.deceased ?? false);
```

(d) Pass `deceased` to the preview avatar — update the `<Avatar>` call inside the avatar `IconButton`:

```tsx
                  <Avatar gender={gender as Gender} age={age === "" ? null : Number(age)} src={avatarSrc} deceased={deceased} />
```

(e) Add the checkbox control after the «Возраст» `TextField` (before the «Связи» `Box`):

```tsx
            <FormControlLabel
              control={<Checkbox checked={deceased} onChange={(e) => setDeceased(e.target.checked)} />}
              label="Умер"
            />
```

(f) Include `deceased` in the submitted object — update the `onSubmit` call in `submit`:

```ts
    onSubmit({
      gender: gender as Gender,
      firstName: firstName.trim(),
      lastName: lastName.trim() || null,
      middleName: middleName.trim() || null,
      age: age === "" ? null : Number(age),
      deceased,
      relations,
    }, avatar);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace web -- CharacterModal`
Expected: PASS (both new tests plus the existing ones — the existing first test uses `objectContaining`, so the added `deceased` key does not break it).

- [ ] **Step 7: Verify the whole web build type-checks**

Per the CLAUDE.md gotcha, esbuild/Vitest ignore issues that `tsc` catches.

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no output (exit 0).

- [ ] **Step 8: Commit**

```bash
git add web/src/api/client.ts web/src/screens/BookScreen.tsx web/src/components/CharacterModal.tsx web/src/components/__tests__/CharacterModal.test.tsx
git commit -m "feat(web): «Умер» checkbox wired through CharacterModal + live preview"
```

---

### Task 7: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Schema + Gotchas notes)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: green full test run; documented behaviour.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS across both workspaces.

- [ ] **Step 2: Type-check both packages**

Run: `npx tsc --noEmit -p web/tsconfig.json && npm run build --workspace server`
Expected: both succeed (server build is `tsc`; catches `server.ts`-class type errors Vitest skips).

- [ ] **Step 3: Document the feature**

In `CLAUDE.md`, add to the **Schema** paragraph a sentence noting `Character.deceased` (`Boolean @default(false)`) is a symmetric status flag rendered as an X+veil overlay. Add a **Gotchas** bullet:

> **Deceased overlay is one SVG, layered twice** — `deceasedOverlaySvg()` (`web/src/lib/avatarSvg.ts`) is the single source for the veil+X. The React `Avatar` draws it as an absolutely-positioned layer; `graphAdapter` emits it as `overlayUri` (a sized, `encodeURIComponent`'d `data:image/svg+xml,` URI, **`null` when alive** so `MindMap`'s in-place `data()` merge clears a stale overlay), which `MindMap`'s `background-image`/`background-fit` mappers layer over `avatarUri`. Don't re-inline the X geometry.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document Character.deceased overlay"
```

---

## Self-Review

**Spec coverage:**
- Data model (`deceased` column, schema, graph payload) → Task 1. ✓
- Single overlay source of truth → Task 2. ✓
- Modal `Avatar` overlay render path → Task 3. ✓
- Canvas render path (graphAdapter `overlayUri` + MindMap layering) → Tasks 4 & 5. ✓
- Web plumbing (type, `CharacterInput`, `BookScreen.initial`, modal checkbox «Умер» after «Возраст», live preview) → Tasks 4 & 6. ✓
- "Dimming" via veil baked into the overlay (canvas can't grayscale) → Task 2 (veil circle), used by Tasks 3 & 5. ✓
- Testing across server + web → every task is TDD; Task 7 runs the full suite + builds. ✓

**Type consistency:** `deceasedOverlaySvg(opts?: { sized?: boolean })` defined in Task 2 is consumed with the same signature in Tasks 3 (no arg) and 4 (`{ sized: true }`). `overlayUri` produced in Task 4 is consumed by name in Task 5. `Character.deceased` added in Task 4 (web type) / Task 1 (server) is read in Tasks 4 & 6. `CharacterInput.deceased` added in Task 6 matches the server `characterCreateSchema` shape from Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✓
