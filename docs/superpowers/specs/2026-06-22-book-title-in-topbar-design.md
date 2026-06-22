# Book title in the top bar — design

**Date:** 2026-06-22
**Status:** Approved

## Goal

When a book is open (the mind-map canvas in `BookScreen`), the top bar shows the
book's name instead of the constant `"Roles Mind Map"`.

## Current state

`web/src/components/TopBar.tsx` hardcodes the text `"Roles Mind Map"` in its
`Typography`. It is used in two places:

- `web/src/screens/BookScreen.tsx` — `<TopBar onBack onEdit onDelete />`
- `web/src/screens/BooksScreen.tsx` — `<TopBar />`

The book title is already available client-side: `getBookGraph` returns
`{ title, nodes, edges }` and `BookScreen` holds it as `graph.title`
(`BookGraph.title?: string`). No API or schema change is needed.

## Design

### `TopBar.tsx`

Add an optional `title` prop:

```ts
interface Props {
  title?: string;
  onBack?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}
```

- Render `{title || "Roles Mind Map"}` in the `Typography`. The `|| "Roles Mind Map"`
  fallback covers both the no-title call site (`BooksScreen`) and the loading
  flash in `BookScreen` (where `graph.title` is `""` until the fetch resolves).
- Truncate long titles with an ellipsis on a single line. Add to the
  `Typography` `sx`: `noWrap` (or `whiteSpace: "nowrap"`),
  `overflow: "hidden"`, `textOverflow: "ellipsis"`. The existing `flex: 1`
  between the two fixed 96px-wide icon boxes already bounds the width, so the
  text clamps to one line and shows `…` when it overflows. Bar height stays
  fixed.

### `BookScreen.tsx`

Pass `title={graph.title}` to `<TopBar>`. No other change.

### `BooksScreen.tsx`

Unchanged — `<TopBar />` with no `title` keeps showing `"Roles Mind Map"`.

## Behavior

- No API/schema changes; the title already arrives via `getBookGraph`.
- After a book rename, `BookScreen` already re-fetches the graph, so the bar
  updates automatically.

## Testing

- Add a small `TopBar` render test (no existing dedicated test):
  - shows a passed `title`,
  - falls back to `"Roles Mind Map"` when `title` is absent or `""`.
- Existing `BookScreen` / `BooksScreen` tests stay green (additive prop only).

## Out of scope

- Two-line wrapping and font-shrinking for long titles (rejected in favor of
  single-line ellipsis).
- Any server-side change.
