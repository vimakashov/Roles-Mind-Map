# Canvas Avatars, Two-Line Names & ×3 Spacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render book characters on the mind-map canvas as schematic SVG avatars with two-line names in a white plaque, and triple the default auto-layout spacing.

**Architecture:** Extract the existing `Avatar.tsx` silhouette into a pure `avatarSvgMarkup(gender, age): string` function shared by the React component (via `dangerouslySetInnerHTML`) and the graph adapter (as a `data:image/svg+xml,…` URI). `graphAdapter.toElements` gains an `avatarUri` field and emits a newline-joined label. `MindMap.tsx` styles nodes to use the avatar as a `background-image`, wraps the label in a plaque like edge labels, and passes explicit `edgeLength`/`nodeSpacing` (base × `SPACING_FACTOR = 3`) to the cola layout. Saved `posX`/`posY` are untouched.

**Tech Stack:** React 18 + TypeScript, Cytoscape.js + cytoscape-cola, Vitest + Testing Library, Vite.

---

## File Structure

- `web/src/lib/avatarSvg.ts` — **new.** Pure function returning a standalone SVG markup string (gender colour + age-based head size). Single source of truth for the silhouette geometry.
- `web/src/lib/__tests__/avatarSvg.test.ts` — **new.** Unit tests for `avatarSvgMarkup`.
- `web/src/components/Avatar.tsx` — **modify.** Render the shared markup instead of inlining the SVG. Preserve `data-testid`, `data-avatar`, `aria-label`.
- `web/src/lib/graphAdapter.ts` — **modify.** Two-line `label`, new `avatarUri` field; keep `avatar` key.
- `web/src/lib/__tests__/graphAdapter.test.ts` — **modify.** Two-line label expectation + `avatarUri` assertion.
- `web/src/canvas/MindMap.tsx` — **modify.** Node style (avatar background, label plaque), cola spacing ×3.

---

## Task 1: Extract the avatar SVG into a shared pure function

**Files:**
- Create: `web/src/lib/avatarSvg.ts`
- Test: `web/src/lib/__tests__/avatarSvg.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/avatarSvg.test.ts`:

```ts
import { expect, test } from "vitest";
import { avatarSvgMarkup } from "../avatarSvg.js";
import { GENDER_COLORS } from "../../theme.js";

test("returns a standalone SVG string with xmlns and gender-colour fill", () => {
  const svg = avatarSvgMarkup("male", 30);
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain(GENDER_COLORS.male); // "#7e9bc4"
  expect(svg).toContain('data-avatar="male-adult"');
});

test("head radius reflects the age stage", () => {
  expect(avatarSvgMarkup("female", 8)).toContain('r="18"');  // child: 0.18 * 100
  expect(avatarSvgMarkup("female", 14)).toContain('r="20"'); // teen:  0.20 * 100
  expect(avatarSvgMarkup("female", 30)).toContain('r="22"'); // adult: 0.22 * 100
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- avatarSvg`
Expected: FAIL — `Failed to resolve import "../avatarSvg.js"` / `avatarSvgMarkup is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/lib/avatarSvg.ts`:

```ts
import type { Gender } from "../types.js";
import { avatarKey } from "./avatar.js";
import { ageStage } from "./ageStage.js";
import { GENDER_COLORS } from "../theme.js";

// Single source of truth for the schematic character silhouette.
// Returns a standalone SVG string usable both as React innerHTML and as a
// `data:image/svg+xml,` URI (hence the explicit xmlns).
export function avatarSvgMarkup(gender: Gender, age: number | null | undefined): string {
  const key = avatarKey(gender, age);
  const fill = GENDER_COLORS[gender];
  const light = gender === "male" ? "#eaf0f7" : "#fbeef3";
  // Slightly smaller head for child/teen for a schematic age cue.
  const stage = ageStage(age);
  const headR = stage === "child" ? 18 : stage === "teen" ? 20 : 22;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-avatar="${key}" ` +
    `viewBox="0 0 100 100" role="img" aria-label="${key}">` +
    `<circle cx="50" cy="50" r="48" fill="${fill}"/>` +
    `<circle cx="50" cy="44" r="${headR}" fill="${light}"/>` +
    `<path d="M30 78 a20 16 0 0 1 40 0 Z" fill="${light}"/>` +
    `</svg>`
  );
}
```

Note: head radius is expressed directly in viewBox units (18/20/22) rather than the old `headR * 100` form so the emitted attribute is an exact integer the test can match.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- avatarSvg`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/avatarSvg.ts web/src/lib/__tests__/avatarSvg.test.ts
git commit -m "feat(web): extract avatar silhouette into shared avatarSvgMarkup"
```

---

## Task 2: Render `Avatar.tsx` from the shared markup

**Files:**
- Modify: `web/src/components/Avatar.tsx`
- Test (existing, must stay green): `web/src/components/__tests__/Avatar.test.tsx`

- [ ] **Step 1: Run the existing Avatar test to confirm the baseline is green**

Run: `npm run test --workspace web -- Avatar`
Expected: PASS — `uses gender color and exposes stage via test id`.

- [ ] **Step 2: Replace the component body to reuse the shared markup**

Replace the entire contents of `web/src/components/Avatar.tsx` with:

```tsx
import type { Gender } from "../types.js";
import { avatarKey } from "../lib/avatar.js";
import { avatarSvgMarkup } from "../lib/avatarSvg.js";

interface Props {
  gender: Gender;
  age?: number | null;
  size?: number;
}

export function Avatar({ gender, age, size = 56 }: Props) {
  return (
    <span
      data-testid="avatar"
      data-avatar={avatarKey(gender, age)}
      aria-label={avatarKey(gender, age)}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: avatarSvgMarkup(gender, age) }}
    />
  );
}
```

The wrapping `<span>` carries the test attributes; `getByTestId("avatar")` still finds it and `toHaveAttribute("data-avatar", …)` still passes. The silhouette geometry now lives only in `avatarSvg.ts`.

- [ ] **Step 3: Run the Avatar test to verify it still passes**

Run: `npm run test --workspace web -- Avatar`
Expected: PASS — `uses gender color and exposes stage via test id`.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Avatar.tsx
git commit -m "refactor(web): render Avatar from shared avatarSvgMarkup"
```

---

## Task 3: Two-line label + `avatarUri` in the graph adapter

**Files:**
- Modify: `web/src/lib/graphAdapter.ts`
- Test: `web/src/lib/__tests__/graphAdapter.test.ts`

- [ ] **Step 1: Update the tests for the new label and avatarUri**

In `web/src/lib/__tests__/graphAdapter.test.ts`, change the label assertion on line 16 from:

```ts
  expect(vNode.data.label).toBe("Вася В");
```

to (and add the avatarUri assertion right after it):

```ts
  expect(vNode.data.label).toBe("Вася\nВ");
  expect(vNode.data.avatar).toBe("male-adult");
  expect(vNode.data.avatarUri as string).toContain("data:image/svg+xml,");
```

(Remove the now-duplicated `expect(vNode.data.avatar).toBe("male-adult");` line that previously followed, so the avatar assertion appears once.)

The existing empty-lastName test (`expect(els[0].data.label).toBe("Анна")`) stays as-is — `filter(Boolean).join("\n")` already drops the empty surname so there is no trailing newline.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- graphAdapter`
Expected: FAIL — `expected "Вася В" to be "Вася\nВ"` and `avatarUri` is `undefined`.

- [ ] **Step 3: Update the adapter**

In `web/src/lib/graphAdapter.ts`, add the import below the existing `avatarKey` import:

```ts
import { avatarSvgMarkup } from "./avatarSvg.js";
```

Then replace the node `data` object (currently lines 12-17) with:

```ts
      data: {
        id: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join("\n"),
        avatar: avatarKey(c.gender, c.age),
        avatarUri: "data:image/svg+xml," + encodeURIComponent(avatarSvgMarkup(c.gender, c.age)),
        gender: c.gender,
      },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace web -- graphAdapter`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/graphAdapter.ts web/src/lib/__tests__/graphAdapter.test.ts
git commit -m "feat(web): emit two-line label and avatarUri from graph adapter"
```

---

## Task 4: Canvas — avatar background, label plaque, ×3 spacing

**Files:**
- Modify: `web/src/canvas/MindMap.tsx`

This task is visual; there is no unit test for Cytoscape styling. Steps below end with a typecheck and a manual verification step.

- [ ] **Step 1: Add the spacing constants**

In `web/src/canvas/MindMap.tsx`, immediately after `cytoscape.use(cola);` (line 8), add:

```ts
// Spacing applies to auto-layout only; saved posX/posY are not scaled.
const SPACING_FACTOR = 3;
const BASE_EDGE_LENGTH = 50;
const BASE_NODE_SPACING = 10;
```

- [ ] **Step 2: Update the node style block**

Replace the `node` selector style object (currently lines 26-38) with:

```ts
        {
          selector: "node",
          style: {
            "background-color": (ele: any) => GENDER_COLORS[ele.data("gender") as "male" | "female"],
            "background-image": "data(avatarUri)",
            "background-fit": "cover",
            "border-width": 2,
            "border-color": "#ffffff",
            label: "data(label)",
            "text-wrap": "wrap",
            "text-valign": "bottom",
            "text-margin-y": 6,
            "font-size": 11,
            color: "#54413f",
            "text-background-color": "#ffffff",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
            width: 46,
            height: 46,
          },
        },
```

`background-color` remains as a fallback behind the avatar image; the white border separates the circular avatar from the canvas; `text-wrap: "wrap"` makes Cytoscape honour the `\n` in the label; the `text-background-*` keys give the name the same white plaque the edge labels already use.

- [ ] **Step 3: Add explicit spacing to the cola layout**

Replace the layout line (currently line 56):

```ts
      layout: { name: "cola", animate: true, infinite: true, fit: false } as any,
```

with:

```ts
      layout: {
        name: "cola",
        animate: true,
        infinite: true,
        fit: false,
        edgeLength: BASE_EDGE_LENGTH * SPACING_FACTOR,
        nodeSpacing: BASE_NODE_SPACING * SPACING_FACTOR,
      } as any,
```

The in-place sync effect (lines 75-87) already copies all mutable `data` fields, so `avatarUri` updates automatically when a character's gender/age changes — no change needed there.

- [ ] **Step 4: Typecheck the web package**

Run: `npm run build --workspace web`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manual visual verification**

Run: `npm run dev:server` and `npm run dev:web`, open http://localhost:5173, open a book and:
- Confirm nodes render as **circular avatars** (gender colour + light head/shoulders) rather than plain filled circles.
- Confirm names appear on **two lines** (first name / last name) inside a **white rounded plaque** under each node; a character with no surname shows one line.
- Add a few new characters (no saved positions) and confirm the auto-layout spreads them roughly **3× farther apart** than before; existing hand-placed maps keep their saved positions.
- Edit a character's gender or age and confirm the avatar updates without a reload.

- [ ] **Step 6: Commit**

```bash
git add web/src/canvas/MindMap.tsx
git commit -m "feat(web): render avatars, two-line name plaques and ×3 spacing on canvas"
```

---

## Self-Review Notes

- **Spec coverage:** ×3 spacing (Task 4, cola only — saved positions untouched) ✓; avatar on canvas reusing the SVG (Tasks 1–4) ✓; two-line names in a plaque (Tasks 3–4) ✓; `avatarUri` added while `avatar` key kept (Task 3) ✓; `Avatar.tsx` reuse without duplicating geometry (Task 2) ✓; tests updated/added (Tasks 1, 3) ✓; existing `Avatar.test.tsx` stays green (Task 2) ✓.
- **Type consistency:** `avatarSvgMarkup(gender, age)` signature is identical across `avatarSvg.ts`, `Avatar.tsx`, and `graphAdapter.ts`. Head radius is emitted as integer viewBox units (18/20/22) so the unit test matches exactly.
- **Decisions deferred to verification:** the exact spacing magnitudes (`BASE_EDGE_LENGTH`, `BASE_NODE_SPACING`) may be tuned in Step 5 of Task 4 if the visual result is too tight or too sparse; the `SPACING_FACTOR = 3` ratio is fixed by the spec.
