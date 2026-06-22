# Book Title in Top Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the open book's name in the canvas top bar instead of the constant "Roles Mind Map".

**Architecture:** Add an optional `title` prop to the existing `TopBar` component that falls back to `"Roles Mind Map"` and truncates long titles with an ellipsis; `BookScreen` passes `graph.title` (already fetched via `getBookGraph`). `BooksScreen` is left unchanged so it keeps the default. No API or schema change.

**Tech Stack:** React 18 + TypeScript + MUI, Vitest + React Testing Library.

## Global Constraints

- UI copy is Russian; the default/fallback bar text is exactly `Roles Mind Map`.
- Run `npx tsc --noEmit -p web/tsconfig.json` after web edits (Vitest/esbuild does not catch all type errors).
- File navigation/editing per `CLAUDE.md` may use Serena MCP tools; standard tools are acceptable for this small change.

---

### Task 1: Title-aware TopBar with ellipsis truncation

**Files:**
- Modify: `web/src/components/TopBar.tsx`
- Modify: `web/src/screens/BookScreen.tsx` (the `<TopBar ... />` call around line 97)
- Test: `web/src/components/__tests__/TopBar.test.tsx` (create)

**Interfaces:**
- Consumes: `BookScreen` already holds `graph.title` (`BookGraph.title?: string`); no new data source.
- Produces: `TopBar` props become `{ title?: string; onBack?: () => void; onEdit?: () => void; onDelete?: () => void }`. The rendered heading text is `title || "Roles Mind Map"`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/TopBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TopBar } from "../TopBar.js";

describe("TopBar", () => {
  it("shows the provided title", () => {
    render(<TopBar title="Война и мир" />);
    expect(screen.getByText("Война и мир")).toBeInTheDocument();
  });

  it("falls back to the app name when title is absent", () => {
    render(<TopBar />);
    expect(screen.getByText("Roles Mind Map")).toBeInTheDocument();
  });

  it("falls back to the app name when title is empty", () => {
    render(<TopBar title="" />);
    expect(screen.getByText("Roles Mind Map")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace web -- TopBar`
Expected: FAIL — `title` prop not yet accepted, the "Война и мир" case finds only "Roles Mind Map".

- [ ] **Step 3: Add the `title` prop and render it with truncation**

In `web/src/components/TopBar.tsx`, add `title?: string` to `interface Props` and to the destructured params, then change the `Typography` to render the title with single-line ellipsis truncation:

```tsx
interface Props {
  title?: string;
  onBack?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TopBar({ title, onBack, onEdit, onDelete }: Props) {
```

Replace the heading element:

```tsx
        <Typography
          variant="h6"
          noWrap
          sx={{ flex: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {title || "Roles Mind Map"}
        </Typography>
```

(Leave the surrounding `AppBar`/`Toolbar`/`Box` icon structure unchanged.)

- [ ] **Step 4: Pass the book title from BookScreen**

In `web/src/screens/BookScreen.tsx`, add the `title` prop to the `<TopBar>` call (currently `onBack`/`onEdit`/`onDelete` only):

```tsx
      <TopBar
        title={graph.title}
        onBack={() => navigate("/")}
        onEdit={() => { setRenameTitle(graph.title ?? ""); setRenameOpen(true); }}
        onDelete={() => setDeleteBookOpen(true)}
      />
```

Leave `web/src/screens/BooksScreen.tsx` unchanged (`<TopBar />` keeps the default).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace web -- TopBar`
Expected: PASS (all three cases).

- [ ] **Step 6: Typecheck the web package**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/TopBar.tsx web/src/screens/BookScreen.tsx web/src/components/__tests__/TopBar.test.tsx
git commit -m "feat(web): show book title in the top bar"
```
