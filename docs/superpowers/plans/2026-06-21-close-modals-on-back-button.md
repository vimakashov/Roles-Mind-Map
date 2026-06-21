# Close Modals on the System "Back" Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single press of the browser/system Back button closes the top-most open overlay (peeling one layer at a time) instead of navigating the router.

**Architecture:** A singleton History-API manager (`backStack`) keeps a stack of open overlays and a count of throwaway history "sentinels". Opening an overlay pushes one sentinel at the **same URL**; a real Back press pops the top overlay's `onClose`; a programmatic close removes its own sentinel via a guarded `history.go`. A thin `useBackClose(open, onClose)` hook wires each overlay into the manager.

**Tech Stack:** React 18 + TypeScript, MUI, Vitest + jsdom + @testing-library/react 16 (`renderHook` available), react-router-dom (unaffected — the manager talks to `window.history` directly).

## Global Constraints

- Sentinels are pushed at the **same URL** (state-marker only, `{ rmmModal: <n> }`) so react-router does not treat a Back-button modal dismissal as a route change. Never pass a URL to `pushState`.
- All `window`/`history` access is guarded by `typeof window !== "undefined"`.
- Files use ESM with `.js` import specifiers (e.g. `import { register } from "./backStack.js"`), matching the existing web codebase.
- Web test runner: Vitest. Run a single web file with `npm run test --workspace web -- <pattern>`. Run the whole web suite with `npm run test --workspace web`.
- After large web edits, the Docker/`build` step is `tsc --noEmit && vite build`; run `npx tsc --noEmit -p web/tsconfig.json` to catch type errors Vitest's esbuild ignores.

---

### Task 1: `backStack` history manager

**Files:**
- Create: `web/src/lib/backStack.ts`
- Test: `web/src/lib/__tests__/backStack.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; uses `window.history`).
- Produces:
  - `interface BackHandle { onClose: () => void }`
  - `register(handle: BackHandle): void`
  - `unregister(handle: BackHandle): void`
  - `__resetBackStack(): void` (test-only — resets the stack and counters; does **not** remove the popstate listener)

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/__tests__/backStack.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";
import { register, unregister, __resetBackStack, type BackHandle } from "../backStack.js";

// reconcile() is queued via queueMicrotask; await a microtask to flush it.
const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));
const handle = (): BackHandle & { onClose: ReturnType<typeof vi.fn> } => ({ onClose: vi.fn() });

beforeEach(() => {
  __resetBackStack();
  vi.restoreAllMocks();
});

test("opening pushes one sentinel per overlay at the same URL", async () => {
  const push = vi.spyOn(window.history, "pushState");
  register(handle());
  register(handle());
  await flush();
  expect(push).toHaveBeenCalledTimes(2);
  // url arg omitted (undefined) → same URL
  expect(push.mock.calls[0][2]).toBeUndefined();
});

test("a real Back press closes only the top overlay, then the next", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const a = handle();
  const b = handle();
  register(a);
  register(b);
  await flush();

  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(b.onClose).toHaveBeenCalledTimes(1);
  expect(a.onClose).not.toHaveBeenCalled();

  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(a.onClose).toHaveBeenCalledTimes(1);
});

test("a programmatic close drops one sentinel and swallows its echo popstate", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const a = handle();
  const b = handle();
  register(a);
  register(b);
  await flush();

  unregister(b);
  await flush();
  expect(go).toHaveBeenCalledWith(-1);

  // jsdom does not fire popstate from history.go; simulate the browser echo.
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(a.onClose).not.toHaveBeenCalled();
  expect(b.onClose).not.toHaveBeenCalled();
});

test("simultaneous closes batch into a single history.go(-n)", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const a = handle();
  const b = handle();
  register(a);
  register(b);
  await flush();

  unregister(a);
  unregister(b);
  await flush();
  expect(go).toHaveBeenCalledTimes(1);
  expect(go).toHaveBeenCalledWith(-2);
});

test("unregister of an already-popped handle is a no-op", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const a = handle();
  register(a);
  await flush();

  window.dispatchEvent(new PopStateEvent("popstate")); // pops `a` via Back
  unregister(a); // React cleanup runs afterwards — must do nothing
  await flush();
  expect(go).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- backStack`
Expected: FAIL — `Failed to resolve import "../backStack.js"` / module not found.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/backStack.ts`:

```ts
// Centralised browser-history guard so the system Back button closes the
// top-most open overlay instead of navigating. See
// docs/superpowers/specs/2026-06-21-close-modals-on-back-button-design.md.

export interface BackHandle {
  onClose: () => void;
}

const MARKER = "rmmModal";

let stack: BackHandle[] = [];
let pushed = 0; // sentinels we believe are in window.history
let guardedPops = 0; // self-induced popstate echoes still to be swallowed
let scheduled = false;
let listening = false;

function onPopState() {
  if (guardedPops > 0) {
    guardedPops--; // our own history.go(-n) echo — ignore
    return;
  }
  if (pushed > 0) {
    pushed--;
    const top = stack.pop();
    top?.onClose();
  }
}

function reconcile() {
  scheduled = false;
  if (typeof window === "undefined") return;
  const desired = stack.length;
  if (desired > pushed) {
    for (let i = pushed; i < desired; i++) {
      window.history.pushState({ ...window.history.state, [MARKER]: i + 1 }, "");
    }
    pushed = desired;
  } else if (desired < pushed) {
    const n = pushed - desired;
    guardedPops += n;
    pushed = desired;
    window.history.go(-n);
  }
}

function scheduleReconcile() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(reconcile);
}

function ensureListener() {
  if (listening || typeof window === "undefined") return;
  window.addEventListener("popstate", onPopState);
  listening = true;
}

export function register(handle: BackHandle): void {
  ensureListener();
  stack.push(handle);
  scheduleReconcile();
}

export function unregister(handle: BackHandle): void {
  const i = stack.indexOf(handle);
  if (i === -1) return; // already popped by a Back press — idempotent
  stack.splice(i, 1);
  scheduleReconcile();
}

// Test-only: reset the stack and counters between tests. Leaves the single
// popstate listener in place (it reads module state on each event).
export function __resetBackStack(): void {
  stack = [];
  pushed = 0;
  guardedPops = 0;
  scheduled = false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace web -- backStack`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/backStack.ts web/src/lib/__tests__/backStack.test.ts
git commit -m "feat(web): history-api back-button manager for modals"
```

---

### Task 2: `useBackClose` hook

**Files:**
- Create: `web/src/lib/useBackClose.ts`
- Test: `web/src/lib/__tests__/useBackClose.test.ts`

**Interfaces:**
- Consumes: `register`, `unregister`, `BackHandle`, `__resetBackStack` from `./backStack.js`.
- Produces: `useBackClose(open: boolean, onClose: () => void): void`

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/__tests__/useBackClose.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBackClose } from "../useBackClose.js";
import { __resetBackStack } from "../backStack.js";

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

beforeEach(() => {
  __resetBackStack();
  vi.restoreAllMocks();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
});

test("registers when open: a Back press fires onClose", async () => {
  const onClose = vi.fn();
  renderHook(() => useBackClose(true, onClose));
  await flush();
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("does not register when closed", async () => {
  const onClose = vi.fn();
  renderHook(() => useBackClose(false, onClose));
  await flush();
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onClose).not.toHaveBeenCalled();
});

test("calls the latest onClose after a re-render (no stale closure)", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = renderHook(({ cb }) => useBackClose(true, cb), {
    initialProps: { cb: first },
  });
  await flush();
  rerender({ cb: second });
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test("unregisters on unmount via a guarded history.go", async () => {
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const { unmount } = renderHook(() => useBackClose(true, vi.fn()));
  await flush();
  unmount();
  await flush();
  expect(go).toHaveBeenCalledWith(-1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- useBackClose`
Expected: FAIL — cannot resolve `../useBackClose.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/useBackClose.ts`:

```ts
import { useEffect, useRef } from "react";
import { register, unregister, type BackHandle } from "./backStack.js";

// While `open`, ensures the system Back button closes this overlay (via the
// shared backStack manager) instead of navigating. `onClose` is held in a ref
// so the manager always invokes the latest closure.
export function useBackClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handle: BackHandle = { onClose: () => onCloseRef.current() };
    register(handle);
    return () => unregister(handle);
  }, [open]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace web -- useBackClose`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/useBackClose.ts web/src/lib/__tests__/useBackClose.test.ts
git commit -m "feat(web): useBackClose hook"
```

---

### Task 3: Wire leaf overlays — `ConfirmDialog` and `AvatarCropDialog`

**Files:**
- Modify: `web/src/components/ConfirmDialog.tsx`
- Modify: `web/src/components/AvatarCropDialog.tsx`
- Test: `web/src/components/__tests__/AvatarCropDialog.test.tsx` (extend)

**Interfaces:**
- Consumes: `useBackClose` from `../lib/useBackClose.js`.
- Produces: no new exports; behaviour change only.

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/__tests__/AvatarCropDialog.test.tsx`:

```ts
import { __resetBackStack } from "../../lib/backStack.js";

test("Back button cancels the crop dialog", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  const file = new File(["x"], "a.png", { type: "image/png" });
  render(<AvatarCropDialog open file={file} onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

Confirm the file's existing imports include `render`, `vi`, `test`, `expect` and the `AvatarCropDialog` component; add `vi`/`expect` to the import from `vitest` if missing (the existing tests already use them).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- AvatarCropDialog`
Expected: FAIL — `onCancel` not called (no Back handling yet).

- [ ] **Step 3: Wire both leaf dialogs**

In `web/src/components/AvatarCropDialog.tsx`, add the import near the top:

```ts
import { useBackClose } from "../lib/useBackClose.js";
```

Then inside `AvatarCropDialog`, immediately after the `const url = useMemo(...)` / reset effects block and before `const save = ...`, add:

```ts
  // Back closes the dialog, but never while a WebP bake is in flight (mirrors
  // the disabled onClose below).
  useBackClose(open, () => { if (!busy) onCancel(); });
```

In `web/src/components/ConfirmDialog.tsx`, add the import:

```ts
import { useBackClose } from "../lib/useBackClose.js";
```

and add this as the first line of the `ConfirmDialog` function body (before `return`):

```ts
  useBackClose(open, onCancel);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace web -- AvatarCropDialog`
Expected: PASS (existing tests + the new Back test).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ConfirmDialog.tsx web/src/components/AvatarCropDialog.tsx web/src/components/__tests__/AvatarCropDialog.test.tsx
git commit -m "feat(web): close ConfirmDialog and AvatarCropDialog on Back"
```

---

### Task 4: Wire `CharacterModal` (dialog + avatar menu) and `RelationsModal` (dialog + colour popper)

**Files:**
- Modify: `web/src/components/CharacterModal.tsx`
- Modify: `web/src/components/RelationsModal.tsx`
- Test: `web/src/components/__tests__/CharacterModal.test.tsx` (extend)
- Test: `web/src/components/__tests__/RelationsModal.test.tsx` (extend)

**Interfaces:**
- Consumes: `useBackClose` from `../lib/useBackClose.js`.
- Produces: no new exports; behaviour change only.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/components/__tests__/CharacterModal.test.tsx` (ensure `vi`, `test`, `expect`, `render`, `screen`, `userEvent` are imported as the existing tests do):

```ts
import { __resetBackStack } from "../../lib/backStack.js";

test("Back button cancels the character modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(
    <CharacterModal open mode="create" others={[]} onCancel={onCancel} onSubmit={() => {}} />,
  );
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

Append to `web/src/components/__tests__/RelationsModal.test.tsx`:

```ts
import { __resetBackStack } from "../../lib/backStack.js";

test("Back button cancels the relations modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(
    <RelationsModal open others={others} value={[]} onCancel={onCancel} onSave={() => {}} />,
  );
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace web -- CharacterModal RelationsModal`
Expected: FAIL — `onCancel` not called in the two new tests.

- [ ] **Step 3: Wire both modals (dialog + their inline popovers)**

In `web/src/components/CharacterModal.tsx`, add the import:

```ts
import { useBackClose } from "../lib/useBackClose.js";
```

Then inside `CharacterModal`, immediately after the state declarations (after the `const avatarSrc = ...` block, before `const pickFile = ...`), add:

```ts
  useBackClose(open, onCancel);
  useBackClose(!!menuAnchor, () => setMenuAnchor(null));
```

In `web/src/components/RelationsModal.tsx`, add the import:

```ts
import { useBackClose } from "../lib/useBackClose.js";
```

Then inside `RelationsModal`, immediately after the state declarations (after the `useEffect(() => { if (open) setEntries(value); }, [open]);` line), add:

```ts
  useBackClose(open, onCancel);
  useBackClose(!!picker, () => setPicker(null));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --workspace web -- CharacterModal RelationsModal`
Expected: PASS (existing tests + the two new Back tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CharacterModal.tsx web/src/components/RelationsModal.tsx web/src/components/__tests__/CharacterModal.test.tsx web/src/components/__tests__/RelationsModal.test.tsx
git commit -m "feat(web): close character/relations modals and their popovers on Back"
```

---

### Task 5: Wire screen-level dialogs — `BooksScreen` and `BookScreen`

**Files:**
- Modify: `web/src/screens/BooksScreen.tsx`
- Modify: `web/src/screens/BookScreen.tsx`
- Test: `web/src/screens/__tests__/BookScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: `useBackClose` from `../lib/useBackClose.js`.
- Produces: no new exports; behaviour change only.

- [ ] **Step 1: Write the failing test**

Append to `web/src/screens/__tests__/BookScreen.test.tsx`. Reuse the existing `MemoryRouter`/`Routes` render helper in that file (the existing tests render `BookScreen` at `/books/b1`); follow the same setup. The new test opens the rename dialog via the pencil button, then dispatches a Back press and asserts the dialog closes without navigating:

```ts
import { __resetBackStack } from "../../lib/backStack.js";

test("Back closes the rename dialog instead of navigating", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  // renderBookScreen() is the existing helper in this file that mounts
  // BookScreen under MemoryRouter at /books/b1 with api mocked.
  renderBookScreen();
  await screen.findByText(/./); // wait for first render/graph load as existing tests do

  await userEvent.click(screen.getByRole("button", { name: /переименовать|изменить/i }));
  expect(await screen.findByText("Переименовать книгу")).toBeInTheDocument();
  await new Promise<void>((r) => queueMicrotask(() => r()));

  window.dispatchEvent(new PopStateEvent("popstate"));
  await waitFor(() =>
    expect(screen.queryByText("Переименовать книгу")).not.toBeInTheDocument(),
  );
});
```

Notes for the implementer:
- If the file does not already expose a `renderBookScreen()` helper, inline the same `MemoryRouter`/`Routes` render block the other tests in this file use.
- The pencil button's accessible name comes from `TopBar`; match it with the case-insensitive regex above. If neither name matches, read `TopBar.tsx` for the `aria-label`/text on the edit `IconButton` and use that exact name.
- Ensure `waitFor` is imported from `@testing-library/react` and `userEvent` from `@testing-library/user-event` (other tests in the file may already import them).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- BookScreen`
Expected: FAIL — the rename dialog stays in the document after the Back press (no Back handling yet).

- [ ] **Step 3: Wire both screens**

In `web/src/screens/BooksScreen.tsx`, add the import:

```ts
import { useBackClose } from "../lib/useBackClose.js";
```

and add, immediately after the `const [open, setOpen] = useState(false);` line:

```ts
  useBackClose(open, () => setOpen(false));
```

In `web/src/screens/BookScreen.tsx`, add the import:

```ts
import { useBackClose } from "../lib/useBackClose.js";
```

and add, immediately after the `const [renameTitle, setRenameTitle] = useState("");` line:

```ts
  useBackClose(deleteBookOpen, () => setDeleteBookOpen(false));
  useBackClose(renameOpen, () => setRenameOpen(false));
```

(The character modal — `modal != null` — is handled inside `CharacterModal` via its own `open`/`onCancel`, so no extra hook is needed here.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace web -- BookScreen`
Expected: PASS (existing tests + the new Back test).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/BooksScreen.tsx web/src/screens/BookScreen.tsx web/src/screens/__tests__/BookScreen.test.tsx
git commit -m "feat(web): close book dialogs on Back"
```

---

### Task 6: Full verification and CLAUDE.md gotcha note

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: documentation only.

- [ ] **Step 1: Run the full web suite**

Run: `npm run test --workspace web`
Expected: PASS — all existing tests plus the new ones. If `MindMap.test.tsx` or other tests now see unexpected `onClose` calls, the cause is a leaked stack between tests; ensure each new Back test calls `__resetBackStack()` in its setup (it does).

- [ ] **Step 2: Type-check the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors. (esbuild/Vitest ignores type-only issues; this is the Docker `build` gate.)

- [ ] **Step 3: Add a gotcha note to CLAUDE.md**

In `CLAUDE.md`, under the `### Gotchas (learned the hard way — keep in mind)` list, add a new bullet:

```markdown
- **Back-button closes modals, not routes** — overlays call `useBackClose(open, onClose)` (`web/src/lib/useBackClose.ts`), backed by the singleton `web/src/lib/backStack.ts`. Opening pushes a throwaway history sentinel **at the same URL** (state-marker only) so react-router doesn't navigate; a real `popstate` closes the top overlay; a programmatic close drops its sentinel via a guarded `history.go`. The `guardedPops` counter + microtask-batched `reconcile` swallow self-induced echoes and collapse simultaneous closes (e.g. delete-character closes ConfirmDialog *and* CharacterModal → one `history.go(-2)`). Don't replace it with naive per-hook `popstate` listeners — those cascade-close the parent. Tests must call `__resetBackStack()` and dispatch `popstate` manually (jsdom doesn't fire it from `history.go`). `AvatarCropDialog` ignores Back while `busy` (WebP baking).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note back-button modal handling in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- Manager (`backStack.ts`) with stack/`pushed`/`guardedPops`/microtask reconcile → Task 1. ✓
- `useBackClose` hook with ref indirection → Task 2. ✓
- Same-URL sentinel (no react-router navigation) → Task 1 implementation + Global Constraints. ✓
- Every overlay in the spec's inventory wired: ConfirmDialog, AvatarCropDialog (Task 3); CharacterModal dialog + avatar Menu, RelationsModal dialog + colour Popper (Task 4); BooksScreen new-book, BookScreen rename + delete-book (Task 5); character modal covered by CharacterModal's own hook (noted in Task 5). ✓
- AvatarCropDialog ignores Back while baking → Task 3 Step 3. ✓
- Flows (nesting, programmatic close, cascade `go(-2)`, close+navigate) → exercised by Task 1 batch/guard tests + component tests; cascade behaviour is a property of the batched reconcile proven in Task 1. ✓
- Testing strategy (manager unit, hook test, component integration, `__resetBackStack`, manual `popstate`) → Tasks 1, 2, 3, 4, 5. ✓
- Full-suite + tsc gate → Task 6. ✓

**Placeholder scan:** No TBD/TODO; all code steps show full code. The one indirection ("reuse the existing render helper" in Task 5) is unavoidable because the test file's exact helper name varies — explicit fallback (inline the MemoryRouter block) and the exact strings to match are given.

**Type consistency:** `BackHandle { onClose }`, `register`/`unregister`/`__resetBackStack`, and `useBackClose(open, onClose)` are used identically across Tasks 1–6.
