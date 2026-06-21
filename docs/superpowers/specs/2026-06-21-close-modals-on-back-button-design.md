# Close modals on the system "Back" button

**Date:** 2026-06-21
**Status:** Approved (design)

## Problem

The web app uses `react-router-dom` (`BrowserRouter`) with two routes (`/` and
`/books/:bookId`), but every modal/overlay is controlled by **local React
state**, not by the URL. So when an overlay is open and the user presses the
system/browser **Back** button (common on Android), the browser walks the
router history (e.g. `/books/:id` → `/`) instead of dismissing the overlay. The
expected behaviour is: Back should close the top-most open overlay (discarding
unsaved changes, exactly like clicking «Отмена» / the backdrop), and only
navigate once no overlay is open.

## Goal

A single **Back** press closes the top-most open overlay, peeling one layer at a
time. This applies to **all** overlays — full `Dialog`s *and* the lightweight
avatar `Menu` and colour-picker `Popper`.

### Overlay inventory (with current open state / close handler)

| Overlay | Owner component | open | close |
| --- | --- | --- | --- |
| New-book dialog | `BooksScreen` | `open` | `setOpen(false)` |
| Rename-book dialog | `BookScreen` | `renameOpen` | `setRenameOpen(false)` |
| Delete-book confirm | `BookScreen` (`ConfirmDialog`) | `deleteBookOpen` | `onCancel` |
| Character modal | `BookScreen` (`CharacterModal`) | `modal != null` | `onCancel` → `setModal(null)` |
| Avatar menu | `CharacterModal` (`Menu`) | `!!menuAnchor` | `setMenuAnchor(null)` |
| Avatar crop dialog | `CharacterModal` (`AvatarCropDialog`) | `!!cropFile` | `onCancel` (ignored while baking) |
| Relations modal | `CharacterModal` (`RelationsModal`) | `relationsOpen` | `onCancel` |
| Delete-character confirm | `CharacterModal` (`ConfirmDialog`) | `confirmOpen` | `onCancel` |
| Colour-picker popper | `RelationsModal` (`Popper`) | `!!picker` | `setPicker(null)` |

## Approach

Pure History-API guard (chosen over a `Dialog` wrapper and over a
router/URL-driven refactor): the smallest change that covers every overlay
uniformly and keeps modal state where it already lives (local React state).

Each overlay declares `useBackClose(open, onClose)`. A singleton manager keeps a
stack of open overlays and a count of throwaway history entries ("sentinels") it
has pushed. Opening an overlay pushes one sentinel; a real Back press pops the
top overlay's `onClose`; a programmatic close removes its own sentinel without
cascading into the parent.

## Components

### 1. `web/src/lib/backStack.ts` — singleton history manager

State:

- `stack: Handle[]` — open overlays, top = last element. `Handle = { onClose: () => void }`.
- `pushed: number` — sentinels currently believed to be in browser history.
- `guardedPops: number` — pending self-induced `popstate` echoes to ignore.
- a `scheduled` flag for microtask batching.

`desired` is always `stack.length`.

API:

- `register(handle)` — `stack.push(handle)`; `scheduleReconcile()`. Returns nothing; caller keeps the same `handle` identity for `unregister`.
- `unregister(handle)` — remove `handle` from `stack` if present (**idempotent**); `scheduleReconcile()`.
- `scheduleReconcile()` — if not already scheduled, `queueMicrotask(reconcile)`. Batching is what collapses simultaneous closes into one history op.
- `reconcile()`:
  - `desired > pushed` → push `(desired - pushed)` sentinels via
    `history.pushState({ ...history.state, rmmModal: <n> }, "")` (no URL arg →
    **same URL**, so react-router observes the same location and does not
    navigate); set `pushed = desired`.
  - `desired < pushed` → `n = pushed - desired`; `guardedPops += n`;
    `pushed = desired`; `history.go(-n)`.
  - else no-op.
- `popstate` listener (registered once, lazily, on first `register`):
  - if `guardedPops > 0` → `guardedPops--`; return (our own echo).
  - else (user pressed Back): if `pushed > 0` → `pushed--`; `const top = stack.pop()`; `top?.onClose()`. (No reconcile-push here — `pushed` and `desired` are decremented in lockstep, so they stay equal.)

All `window`/`history` access is guarded by `typeof window !== "undefined"`.

**Why a shared stack rather than per-hook listeners:** a naive per-hook
`popstate` listener + cleanup-time `history.back()` makes a programmatic close of
the top overlay fire a `popstate` that the still-mounted **parent** overlay's
listener also receives — closing the parent unintentionally. Centralising into
one manager with a guard counter ensures only the top overlay responds to a real
Back, and self-induced pops are swallowed.

### 2. `web/src/lib/useBackClose.ts` — `useBackClose(open: boolean, onClose: () => void)`

- Holds `onClose` in a ref updated every render, so the manager always calls the
  latest closure (same stale-closure mitigation the canvas already uses).
- A `useEffect` keyed on `open`: when `open` is true, build a stable `handle`
  (`{ onClose: () => onCloseRef.current() }`), `register(handle)`, and return a
  cleanup that calls `unregister(handle)`. When `open` is false the effect is a
  no-op. This covers both transitions and unmount-while-open.

### 3. Wiring (one `useBackClose` call per overlay, in the component that owns its open state)

- **BooksScreen** — `useBackClose(open, () => setOpen(false))`.
- **BookScreen** — `useBackClose(renameOpen, () => setRenameOpen(false))` and
  `useBackClose(deleteBookOpen, () => setDeleteBookOpen(false))`. The character
  modal handles its own (it receives `open` + `onCancel`).
- **CharacterModal** — `useBackClose(open, onCancel)` for the dialog and
  `useBackClose(!!menuAnchor, () => setMenuAnchor(null))` for the avatar menu.
  The nested `RelationsModal` / `AvatarCropDialog` / `ConfirmDialog` register
  themselves.
- **RelationsModal** — `useBackClose(open, onCancel)` for the dialog and
  `useBackClose(!!picker, () => setPicker(null))` for the colour popper.
- **AvatarCropDialog** — `useBackClose(open, onClose)` where the passed
  `onClose` **does nothing while `busy`** (reads `busy` via a ref so the handle
  identity is stable), mirroring the existing `onClose={busy ? undefined : onCancel}`.
- **ConfirmDialog** — `useBackClose(open, onCancel)`.

## Key flows this must satisfy

- **Nesting:** Character → Relations → colour Popper. Three Back presses peel
  Popper, then Relations, then Character — one layer each.
- **Programmatic close:** Relations «Сохранить» / rename «Сохранить» drop exactly
  one sentinel (via guarded `history.go(-1)`) and leave the parent open — no
  parent cascade.
- **Multi-close in one tick:** delete-character confirm runs
  `setConfirmOpen(false); onDelete()` → `setModal(null)`, closing `ConfirmDialog`
  **and** `CharacterModal` together. Both `unregister` in the same tick; the
  microtask reconcile collapses to a single `history.go(-2)`.
- **Close + navigate:** delete-book confirm runs `setDeleteBookOpen(false)` then
  the awaited `removeBook()` → `navigate("/")`. The reconcile runs on a microtask
  before the awaited API call resolves, so the sentinel is dropped before the
  navigation — no race. Worst case (if ever reordered) is one redundant sentinel,
  which is harmless (one extra Back).

## Testing

- **`backStack` unit tests:** register two handles → dispatch a `popstate` →
  only the top's `onClose` fires and `pushed` decrements; programmatic
  `unregister` of the top schedules a guarded `history.go` and the echo
  `popstate` is swallowed; two `unregister`s in one tick batch into a single
  reconcile. Spy on `history.pushState` / `history.go`.
- **`useBackClose` test:** a probe component toggles `open`; assert
  register-on-open / unregister-on-close and that a `popstate` invokes the latest
  `onClose` (verifies the ref indirection).
- **Component integration:** extend `CharacterModal` / `RelationsModal` tests to
  dispatch `popstate` and assert the correct single overlay closes (including the
  nested Popper case). Existing `MemoryRouter`-based tests are unaffected — the
  manager talks to `window.history` directly, independent of react-router.
- jsdom does not synchronously fire `popstate` from `history.go`/`back`, so tests
  drive `popstate` by dispatching the event and rely on the manager's own
  `guardedPops` counter (not on a real browser pop) for self-induced cleanup.

## Notes for CLAUDE.md (post-implementation)

- Sentinels are pushed at the **same URL** (state-marker only) so react-router
  does not treat Back-button modal dismissal as a route change.
- The manager's `guardedPops` counter and microtask-batched reconcile are what
  prevent echo-cascades and collapse simultaneous closes; don't replace it with
  naive per-hook `popstate` listeners.
- `AvatarCropDialog` deliberately ignores Back while `busy` (WebP baking),
  matching its disabled `onClose`.

## Out of scope

- No URL/route changes for modals (no deep-linking to an open modal).
- No change to existing Escape-key / backdrop-click dismissal (MUI default).
