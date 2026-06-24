# Relations Picker Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort the character-picker dropdown in `RelationsModal` so Latin-script names appear first (descending Z→A) and Cyrillic names second (descending Я→А), keyed on the displayed «Имя Фамилия».

**Architecture:** A new pure, non-mutating comparator helper in `web/src/lib/` (matching the existing pure-helper + unit-test convention, e.g. `layout.ts`). `RelationsModal` wraps its existing `available` list computation with the helper. No server/schema/API change.

**Tech Stack:** TypeScript, React 18, Vitest (esbuild runner), MUI.

## Global Constraints

- Web unit tests import from Vitest as `import { expect, test } from "vitest";` and reference source modules with a `.js` extension (e.g. `../sortCharacters.js`), even though the file is `.ts`.
- `Character.lastName` is `string | null | undefined` — the display name must use `lastName ?? ""` then `.trim()`, identical to the `Menu` render in `RelationsModal.tsx`.
- The helper must be **non-mutating** (sort a copy).
- Single web test file pattern: `npm run test --workspace web -- <pattern>`.
- After web edits, typecheck with `npx tsc --noEmit -p web/tsconfig.json` (Vitest's esbuild does not catch type errors — see CLAUDE.md gotcha).
- Non-letter-leading names (digits/punctuation) bucket with the **Latin** group (group 0).

---

### Task 1: `sortForPicker` pure helper

**Files:**
- Create: `web/src/lib/sortCharacters.ts`
- Test: `web/src/lib/__tests__/sortCharacters.test.ts`

**Interfaces:**
- Consumes: nothing (leaf helper).
- Produces: `export function sortForPicker<T extends { firstName: string; lastName?: string | null }>(chars: T[]): T[]` — returns a new array sorted with Latin-script display names first (descending), then Cyrillic display names (descending). Display name = `` `${firstName} ${lastName ?? ""}`.trim() ``.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/sortCharacters.test.ts`:

```ts
import { expect, test } from "vitest";
import { sortForPicker } from "../sortCharacters.js";

type C = { id: string; firstName: string; lastName?: string | null };
const names = (cs: C[]) => cs.map((c) => `${c.firstName} ${c.lastName ?? ""}`.trim());

test("Latin block comes before Cyrillic block", () => {
  const input: C[] = [
    { id: "1", firstName: "Анна", lastName: null },
    { id: "2", firstName: "Bob", lastName: null },
  ];
  expect(names(sortForPicker(input))).toEqual(["Bob", "Анна"]);
});

test("Latin group is sorted descending", () => {
  const input: C[] = [
    { id: "1", firstName: "Adam", lastName: null },
    { id: "2", firstName: "Zoe", lastName: null },
    { id: "3", firstName: "Mia", lastName: null },
  ];
  expect(names(sortForPicker(input))).toEqual(["Zoe", "Mia", "Adam"]);
});

test("Cyrillic group is sorted descending", () => {
  const input: C[] = [
    { id: "1", firstName: "Анна", lastName: null },
    { id: "2", firstName: "Яна", lastName: null },
    { id: "3", firstName: "Мила", lastName: null },
  ];
  expect(names(sortForPicker(input))).toEqual(["Яна", "Мила", "Анна"]);
});

test("mixed interleaved input is grouped then descending", () => {
  const input: C[] = [
    { id: "1", firstName: "Мила", lastName: null },
    { id: "2", firstName: "Adam", lastName: null },
    { id: "3", firstName: "Яна", lastName: null },
    { id: "4", firstName: "Zoe", lastName: null },
  ];
  expect(names(sortForPicker(input))).toEqual(["Zoe", "Adam", "Яна", "Мила"]);
});

test("uses full display name including lastName", () => {
  const input: C[] = [
    { id: "1", firstName: "Ivan", lastName: "Adams" },
    { id: "2", firstName: "Ivan", lastName: "Zorin" },
  ];
  expect(names(sortForPicker(input))).toEqual(["Ivan Zorin", "Ivan Adams"]);
});

test("null lastName produces no trailing space and sorts on first name", () => {
  const input: C[] = [
    { id: "1", firstName: "Ben", lastName: null },
    { id: "2", firstName: "Ann", lastName: undefined },
  ];
  expect(names(sortForPicker(input))).toEqual(["Ben", "Ann"]);
});

test("a digit-leading name buckets with the Latin group", () => {
  const input: C[] = [
    { id: "1", firstName: "Анна", lastName: null },
    { id: "2", firstName: "3PO", lastName: null },
    { id: "3", firstName: "Zoe", lastName: null },
  ];
  // Latin group (Zoe, 3PO) descending, then Cyrillic (Анна)
  expect(names(sortForPicker(input))).toEqual(["Zoe", "3PO", "Анна"]);
});

test("does not mutate the input array", () => {
  const input: C[] = [
    { id: "1", firstName: "Adam", lastName: null },
    { id: "2", firstName: "Zoe", lastName: null },
  ];
  const before = input.map((c) => c.id);
  sortForPicker(input);
  expect(input.map((c) => c.id)).toEqual(before);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- sortCharacters`
Expected: FAIL — cannot resolve `../sortCharacters.js` / `sortForPicker is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/sortCharacters.ts`:

```ts
type PickerChar = { firstName: string; lastName?: string | null };

const displayName = (c: PickerChar) => `${c.firstName} ${c.lastName ?? ""}`.trim();

// Cyrillic block (U+0400–U+04FF) leading char -> group 1; everything else -> group 0.
const CYRILLIC = /[Ѐ-ӿ]/;
const scriptGroup = (name: string) => (CYRILLIC.test(name.charAt(0)) ? 1 : 0);

/**
 * Sort characters for the relations picker dropdown: Latin-script display
 * names first (descending), then Cyrillic display names (descending).
 * Non-mutating — returns a new array.
 */
export function sortForPicker<T extends PickerChar>(chars: T[]): T[] {
  return [...chars].sort((a, b) => {
    const na = displayName(a);
    const nb = displayName(b);
    const ga = scriptGroup(na);
    const gb = scriptGroup(nb);
    if (ga !== gb) return ga - gb; // group 0 (Latin) before group 1 (Cyrillic)
    return nb.localeCompare(na); // descending within group
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- sortCharacters`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/sortCharacters.ts web/src/lib/__tests__/sortCharacters.test.ts
git commit -m "feat(web): sortForPicker helper for relations dropdown ordering"
```

---

### Task 2: Wire `sortForPicker` into `RelationsModal`

**Files:**
- Modify: `web/src/components/RelationsModal.tsx`

**Interfaces:**
- Consumes: `sortForPicker` from `../lib/sortCharacters.js` (Task 1).
- Produces: nothing new (internal wiring only).

- [ ] **Step 1: Add the import**

In `web/src/components/RelationsModal.tsx`, after the existing
`import { LinkChoiceDialog } from "./LinkChoiceDialog.js";` line (line 9), add:

```ts
import { sortForPicker } from "../lib/sortCharacters.js";
```

- [ ] **Step 2: Sort the `available` list**

Replace this line (currently ~line 45 inside the `RelationsModal` function):

```ts
  const available = others.filter((o) => !connectedIds.has(o.id));
```

with:

```ts
  const available = sortForPicker(others.filter((o) => !connectedIds.has(o.id)));
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors (`sortForPicker<Character>` satisfies the constraint; returns `Character[]`).

- [ ] **Step 4: Run the web test suite**

Run: `npm run test --workspace web`
Expected: PASS — no regressions (existing `RelationsModal` / relations tests still green, `sortCharacters` green).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/RelationsModal.tsx
git commit -m "feat(web): sort relations picker dropdown (Latin desc, then Cyrillic desc)"
```

---

## Self-Review

**Spec coverage:**
- Latin-first / Cyrillic-second grouping → Task 1 (`scriptGroup`), tested.
- Descending within each group → Task 1 (`nb.localeCompare(na)`), tested.
- Sort key = full display name «Имя Фамилия» → Task 1 (`displayName`), tested.
- Non-mutating helper → Task 1, tested.
- Non-letter-leading → Latin group → Task 1, tested.
- Wiring only the picker `Menu`, nothing else → Task 2 (single `available` line).
- Out of scope (no server/schema/other dropdowns) → respected; no such tasks.

**Placeholder scan:** none — all steps contain concrete code/commands.

**Type consistency:** `sortForPicker<T extends { firstName: string; lastName?: string | null }>` matches `Character` (`firstName: string`, `lastName?: string | null`); used consistently in both tasks.
