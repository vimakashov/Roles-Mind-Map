# Связь с новым персонажем — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Позволить создать нового персонажа прямо из потока добавления связи, сразу связав его с текущим.

**Architecture:** Внутри `RelationsModal` кнопка «+ Добавить связь» открывает диалог-развилку `LinkChoiceDialog` («Существующий» / «Новый персонаж»). «Существующий» — текущее меню. «Новый персонаж» — текущий персонаж A валидируется и сохраняется немедленно, его окно закрывается, открывается чистая форма создания B с заранее заданной связью на A. Связь A↔B едет в полезной нагрузке `createCharacter(B)`; серверный reconcile создаёт дугу. Серверный API не меняется.

**Tech Stack:** React 18 + TypeScript + MUI, Vitest + @testing-library/react + userEvent. Web-only изменение (server/schema не трогаем).

## Global Constraints

- UI-копирайтинг на русском. Заголовок развилки: `Создать нового персонажа или связать с существующим?`. Кнопки: `Существующий`, `Новый персонаж`.
- Связь — это `RelationConnection = { otherId: string; role: string; color: string | null }`. Новая связь A↔B создаётся как `{ otherId, role: "", color: null }` (пустая роль = безымянная линия, цвет по умолчанию). **Wire-формат связей НЕ меняется** — серверные тесты не затрагиваются.
- Новые/изменяемые оверлеи подключаются к системной кнопке «Назад» через `useBackClose(open, onClose)` ровно как `ConfirmDialog` (компонент сам вызывает `useBackClose` внутри — родитель его не оборачивает повторно).
- После крупных правок web запускать `npx tsc --noEmit -p web/tsconfig.json` (Vitest через esbuild не ловит дубликаты импортов/деклараций и ошибки типов; Docker-сборка ловит).
- Один web-тест по паттерну: `npm run test --workspace web -- <pattern>`. Весь web-набор: `npm run test --workspace web`.
- Тесты с системной «Назад» вызывают `__resetBackStack()` и вручную диспатчат `popstate` (jsdom не стреляет им из `history.go`).

---

### Task 1: `LinkChoiceDialog` — диалог-развилка

**Files:**
- Create: `web/src/components/LinkChoiceDialog.tsx`
- Test: `web/src/components/__tests__/LinkChoiceDialog.test.tsx`

**Interfaces:**
- Consumes: `useBackClose` from `../lib/useBackClose.js`.
- Produces:
  ```ts
  interface Props {
    open: boolean;
    canUseExisting: boolean;   // false => кнопка «Существующий» disabled
    onExisting: () => void;
    onCreateNew: () => void;
    onCancel: () => void;
  }
  export function LinkChoiceDialog(props: Props): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/LinkChoiceDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { LinkChoiceDialog } from "../LinkChoiceDialog.js";

test("calls onExisting when «Существующий» is clicked", async () => {
  const onExisting = vi.fn();
  render(<LinkChoiceDialog open canUseExisting onExisting={onExisting} onCreateNew={() => {}} onCancel={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /существующий/i }));
  expect(onExisting).toHaveBeenCalledTimes(1);
});

test("calls onCreateNew when «Новый персонаж» is clicked", async () => {
  const onCreateNew = vi.fn();
  render(<LinkChoiceDialog open canUseExisting onExisting={() => {}} onCreateNew={onCreateNew} onCancel={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /новый персонаж/i }));
  expect(onCreateNew).toHaveBeenCalledTimes(1);
});

test("disables «Существующий» when there is no one to link to", () => {
  render(<LinkChoiceDialog open canUseExisting={false} onExisting={() => {}} onCreateNew={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole("button", { name: /существующий/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- LinkChoiceDialog`
Expected: FAIL — `Failed to resolve import "../LinkChoiceDialog.js"` (module not created yet).

- [ ] **Step 3: Write the component**

Create `web/src/components/LinkChoiceDialog.tsx`:

```tsx
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from "@mui/material";
import { useBackClose } from "../lib/useBackClose.js";

interface Props {
  open: boolean;
  canUseExisting: boolean;
  onExisting: () => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

export function LinkChoiceDialog({ open, canUseExisting, onExisting, onCreateNew, onCancel }: Props) {
  useBackClose(open, onCancel);
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs">
      <DialogTitle>Создать нового персонажа или связать с существующим?</DialogTitle>
      <DialogContent />
      <DialogActions>
        <Button disabled={!canUseExisting} onClick={onExisting}>Существующий</Button>
        <Button variant="contained" onClick={onCreateNew}>Новый персонаж</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- LinkChoiceDialog`
Expected: PASS (3 passed).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/LinkChoiceDialog.tsx web/src/components/__tests__/LinkChoiceDialog.test.tsx
git commit -m "feat(web): LinkChoiceDialog — existing vs new character choice"
```

---

### Task 2: `RelationsModal` — встроить развилку перед добавлением связи

The «+ Добавить связь» button now shows **always** (раньше — только при `available.length > 0`) и открывает `LinkChoiceDialog`. «Существующий» открывает текущее меню персонажей; «Новый персонаж» вызывает новый колбэк `onCreateNew(rows)` с текущими staged-строками.

**Files:**
- Modify: `web/src/components/RelationsModal.tsx`
- Test: `web/src/components/__tests__/RelationsModal.test.tsx`

**Interfaces:**
- Consumes: `LinkChoiceDialog` from `./LinkChoiceDialog.js` (Task 1).
- Produces: new optional prop on `RelationsModal`:
  ```ts
  onCreateNew?: (rows: RelationConnection[]) => void  // вызывается при выборе «Новый персонаж»
  ```

- [ ] **Step 1: Update the two existing menu tests for the new choice step, and add two new tests**

In `web/src/components/__tests__/RelationsModal.test.tsx`:

Replace the body of the test **"adds a connection via the menu and returns it on save"** with (insert a click on «Существующий» between «добавить связь» and the menu item):

```tsx
test("adds a connection via the menu and returns it on save", async () => {
  const onSave = vi.fn();
  render(<RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /^существующий$/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: /жанна/i }));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ otherId: "z", role: "", color: null }]);
});
```

Replace the body of **"hides already-connected characters from the add menu"** with:

```tsx
test("hides already-connected characters from the add menu", async () => {
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "", color: null }]}
      onCancel={() => {}} onSave={() => {}} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /^существующий$/i }));
  expect(screen.queryByRole("menuitem", { name: /петя/i })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /жанна/i })).toBeInTheDocument();
});
```

Add two new tests at the end of the file:

```tsx
test("«Новый персонаж» returns the current staged rows", async () => {
  const onCreateNew = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "друзья", color: null }]}
      onCancel={() => {}} onSave={() => {}} onCreateNew={onCreateNew} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /новый персонаж/i }));
  expect(onCreateNew).toHaveBeenCalledWith([{ otherId: "p", role: "друзья", color: null }]);
});

test("the add button shows and «Существующий» is disabled when everyone is already connected", async () => {
  render(
    <RelationsModal open others={others}
      value={[{ otherId: "p", role: "", color: null }, { otherId: "z", role: "", color: null }]}
      onCancel={() => {}} onSave={() => {}} onCreateNew={() => {}} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  expect(screen.getByRole("button", { name: /^существующий$/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace web -- RelationsModal`
Expected: FAIL — the two updated tests can't find the «Существующий» button (choice step not implemented); the new tests fail likewise.

- [ ] **Step 3: Implement the choice step in `RelationsModal`**

In `web/src/components/RelationsModal.tsx`:

3a. Add the import after the existing component imports (near the `CommentsModal`/`ConfirmDialog`-style imports — here, after the `@uiw/react-color` import line):

```tsx
import { LinkChoiceDialog } from "./LinkChoiceDialog.js";
```

3b. Extend `Props` to add the optional callback:

```tsx
interface Props {
  open: boolean;
  others: Character[];
  value: RelationConnection[];
  onCancel: () => void;
  onSave: (connections: RelationConnection[]) => void;
  onCreateNew?: (rows: RelationConnection[]) => void;
}
```

and destructure it:

```tsx
export function RelationsModal({ open, others, value, onCancel, onSave, onCreateNew }: Props) {
```

3c. Add a `choiceOpen`/`menuOpen` split. Replace the existing single menu-state line:

```tsx
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
```

with:

```tsx
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
```

3d. Replace the existing menu back-close line:

```tsx
  useBackClose(!!addAnchor, () => setAddAnchor(null));
```

with (the choice dialog handles its own Back internally; we only wire the menu here):

```tsx
  useBackClose(menuOpen, () => { setMenuOpen(false); setAddAnchor(null); });
```

3e. Update `addConnection` to close the menu/flow:

```tsx
  const addConnection = (otherId: string) => {
    setRows((rs) => [...rs, { otherId, role: "", color: null }]);
    setMenuOpen(false);
    setAddAnchor(null);
  };
```

3f. Replace the whole add-button block. Find:

```tsx
        {available.length > 0 && (
          <>
            <Button sx={{ mt: 2 }} onClick={(e) => setAddAnchor(e.currentTarget)}>
              + Добавить связь
            </Button>
            <Menu anchorEl={addAnchor} open={!!addAnchor} onClose={() => setAddAnchor(null)}>
              {available.map((o) => (
                <MenuItem key={o.id} onClick={() => addConnection(o.id)}>
                  {`${o.firstName} ${o.lastName ?? ""}`.trim()}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
```

and replace it with (button always shown; opens the choice; menu opened from «Существующий»):

```tsx
        <Button sx={{ mt: 2 }} onClick={(e) => { setAddAnchor(e.currentTarget); setChoiceOpen(true); }}>
          + Добавить связь
        </Button>
        <Menu anchorEl={addAnchor} open={menuOpen}
          onClose={() => { setMenuOpen(false); setAddAnchor(null); }}>
          {available.map((o) => (
            <MenuItem key={o.id} onClick={() => addConnection(o.id)}>
              {`${o.firstName} ${o.lastName ?? ""}`.trim()}
            </MenuItem>
          ))}
        </Menu>
```

3g. Render the `LinkChoiceDialog` next to the `Popper` (just before the closing `</Dialog>`), after the colour `Popper` block:

```tsx
      <LinkChoiceDialog
        open={choiceOpen}
        canUseExisting={available.length > 0}
        onExisting={() => { setChoiceOpen(false); setMenuOpen(true); }}
        onCreateNew={() => { setChoiceOpen(false); setAddAnchor(null); onCreateNew?.(rows); }}
        onCancel={() => { setChoiceOpen(false); setAddAnchor(null); }}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- RelationsModal`
Expected: PASS (all tests in the file, including the two updated and two new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/RelationsModal.tsx web/src/components/__tests__/RelationsModal.test.tsx
git commit -m "feat(web): RelationsModal opens existing/new choice on add"
```

---

### Task 3: `CharacterModal` — `onCreateLinked` + `presetRelations`

When `RelationsModal` reports «Новый персонаж», `CharacterModal` commits the current relation rows into its own state, validates the form, and (if valid) calls `onCreateLinked(input, avatar)` instead of `onSubmit`. A new `presetRelations` prop seeds the relations of a fresh (linked) create form without touching `initial`.

**Files:**
- Modify: `web/src/components/CharacterModal.tsx`
- Test: `web/src/components/__tests__/CharacterModal.test.tsx`

**Interfaces:**
- Consumes: `RelationsModal` `onCreateNew` prop (Task 2).
- Produces: two new optional props on `CharacterModal`:
  ```ts
  onCreateLinked?: (input: CharacterInput, avatar: AvatarChange) => void;
  presetRelations?: RelationConnection[];   // seeds relations when no `initial` is given
  ```

- [ ] **Step 1: Write the failing test**

Add to `web/src/components/__tests__/CharacterModal.test.tsx`:

```tsx
test("«Новый персонаж» in relations validates A and calls onCreateLinked with staged input", async () => {
  const onCreateLinked = vi.fn();
  render(
    <CharacterModal
      open mode="edit"
      others={[{ id: "p", bookId: "b", gender: "male", firstName: "Петя", lastName: "П" }]}
      initial={{ gender: "female", firstName: "Аня", lastName: "С", deceased: false, relations: [], comments: [] }}
      onCancel={() => {}} onSubmit={() => {}} onCreateLinked={onCreateLinked} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /связи/i }));
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /новый персонаж/i }));
  expect(onCreateLinked).toHaveBeenCalledWith(
    expect.objectContaining({ firstName: "Аня", relations: [] }),
    { kind: "none" },
  );
});

test("presetRelations seeds the staged relation count on a fresh create form", () => {
  render(
    <CharacterModal
      open mode="create" others={[{ id: "a1", bookId: "b", gender: "male", firstName: "Аня", lastName: "С" }]}
      presetRelations={[{ otherId: "a1", role: "", color: null }]}
      onCancel={() => {}} onSubmit={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /связи \(1\)/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace web -- CharacterModal`
Expected: FAIL — `onCreateLinked` is not wired (no «новый персонаж» path reaching the spy) and `presetRelations` is ignored (count is `0`, not `1`).

- [ ] **Step 3: Implement in `CharacterModal`**

In `web/src/components/CharacterModal.tsx`:

3a. Add the two props to `Props` (after `onSubmit`):

```tsx
  onSubmit: (input: CharacterInput, avatar: AvatarChange) => void;
  onCreateLinked?: (input: CharacterInput, avatar: AvatarChange) => void;
  presetRelations?: RelationConnection[];
  onDelete?: () => void;
```

3b. Add them to the destructured params:

```tsx
export function CharacterModal({
  open, mode, others, initial, characterId, avatarUpdatedAt, onCancel, onSubmit, onCreateLinked, presetRelations, onDelete,
}: Props) {
```

3c. Seed relations from `presetRelations` when no `initial`. Replace:

```tsx
  const [relations, setRelations] = useState<RelationConnection[]>(initial?.relations ?? empty.relations);
```

with:

```tsx
  const [relations, setRelations] = useState<RelationConnection[]>(initial?.relations ?? presetRelations ?? empty.relations);
```

3d. Refactor `submit` to share input-building and validation, and add `createLinked`. Replace the existing `submit` function:

```tsx
  const submit = () => {
    const result = characterFormSchema.safeParse({ gender, firstName, lastName, middleName, age });
    if (!result.success) {
      const flat: Record<string, string> = {};
      for (const issue of result.error.issues) flat[String(issue.path[0])] = issue.message;
      setErrors(flat);
      return;
    }
    setErrors({});
    onSubmit({
      gender: gender as Gender,
      firstName: firstName.trim(),
      lastName: lastName.trim() || null,
      middleName: middleName.trim() || null,
      age: age === "" ? null : Number(age),
      deceased,
      relations,
      comments,
    }, avatar);
  };
```

with:

```tsx
  const buildInput = (rels: RelationConnection[]): CharacterInput => ({
    gender: gender as Gender,
    firstName: firstName.trim(),
    lastName: lastName.trim() || null,
    middleName: middleName.trim() || null,
    age: age === "" ? null : Number(age),
    deceased,
    relations: rels,
    comments,
  });

  const validate = (): boolean => {
    const result = characterFormSchema.safeParse({ gender, firstName, lastName, middleName, age });
    if (!result.success) {
      const flat: Record<string, string> = {};
      for (const issue of result.error.issues) flat[String(issue.path[0])] = issue.message;
      setErrors(flat);
      return false;
    }
    setErrors({});
    return true;
  };

  const submit = () => {
    if (!validate()) return;
    onSubmit(buildInput(relations), avatar);
  };

  // «Новый персонаж» from RelationsModal: commit the current rows into A, then
  // validate + hand off to onCreateLinked (which saves A and opens a fresh B).
  const createLinked = (rows: RelationConnection[]) => {
    setRelations(rows);
    setRelationsOpen(false);
    if (!validate()) return;
    onCreateLinked?.(buildInput(rows), avatar);
  };
```

3e. Pass `onCreateNew` to `RelationsModal`. Replace:

```tsx
      <RelationsModal open={relationsOpen} others={others} value={relations}
        onCancel={() => setRelationsOpen(false)}
        onSave={(e) => { setRelations(e); setRelationsOpen(false); }} />
```

with:

```tsx
      <RelationsModal open={relationsOpen} others={others} value={relations}
        onCancel={() => setRelationsOpen(false)}
        onSave={(e) => { setRelations(e); setRelationsOpen(false); }}
        onCreateNew={onCreateLinked ? createLinked : undefined} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace web -- CharacterModal`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no output (exit 0). (Confirms exactly one `submit` definition remains — no leftover duplicate from the whole-function replace.)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/CharacterModal.tsx web/src/components/__tests__/CharacterModal.test.tsx
git commit -m "feat(web): CharacterModal onCreateLinked + presetRelations"
```

---

### Task 4: `BookScreen` — сохранить A и открыть связанную форму B

Wire `onCreateLinked` to a new `submitAndCreateLinked`: save A (create/update + avatar), refresh the graph so A appears, then open a fresh create modal carrying `linkedTo = A.id`. A `key` on `CharacterModal` forces a remount on the A→B transition so the form state resets.

**Files:**
- Modify: `web/src/screens/BookScreen.tsx`
- Test: `web/src/screens/__tests__/BookScreen.test.tsx`

**Interfaces:**
- Consumes: `CharacterModal` props `onCreateLinked`, `presetRelations` (Task 3); `api.createCharacter`, `api.updateCharacter`, `api.setAvatar`, `api.deleteAvatar` (existing).
- Produces: modal state shape gains `linkedTo?: string`.

- [ ] **Step 1: Write the failing test**

Add to `web/src/screens/__tests__/BookScreen.test.tsx`:

```tsx
test("links a brand-new character to an existing one", async () => {
  (api.getGraph as any)
    .mockResolvedValueOnce(oneCharacter)   // initial load: A only
    .mockResolvedValueOnce(oneCharacter)   // refresh after saving A
    .mockResolvedValueOnce({               // refresh after creating B
      title: "Война и мир",
      nodes: [
        oneCharacter.nodes[0],
        { id: "c2", bookId: "b1", gender: "female", firstName: "Маша", lastName: "Иванова" },
      ],
      edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "" }],
    });
  (api.updateCharacter as any).mockResolvedValue({ id: "c1" });
  (api.createCharacter as any).mockResolvedValue({ id: "c2" });

  renderBookScreen();
  await userEvent.click(await screen.findByRole("button", { name: "tap-c1" }));

  // Open relations, start add, pick «Новый персонаж».
  await userEvent.click(await screen.findByRole("button", { name: /связи/i }));
  await userEvent.click(await screen.findByRole("button", { name: /добавить связь/i }));
  await userEvent.click(await screen.findByRole("button", { name: /новый персонаж/i }));

  // A is saved.
  await waitFor(() => expect(api.updateCharacter).toHaveBeenCalledWith("c1", expect.any(Object)));

  // A fresh create form (B) appears. Fill required fields and add.
  expect(await screen.findByText(/^Новый персонаж$/)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText(/пол/i));
  await userEvent.click(screen.getByRole("option", { name: /женщина/i }));
  await userEvent.type(screen.getByLabelText(/^имя/i), "Маша");
  await userEvent.type(screen.getByLabelText(/фамилия/i), "Иванова");
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));

  await waitFor(() =>
    expect(api.createCharacter).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ relations: [{ otherId: "c1", role: "", color: null }] }),
    ),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace web -- BookScreen`
Expected: FAIL — there is no «Новый персонаж» handoff in `BookScreen`, so the create form (`/^Новый персонаж$/` title) never appears / `createCharacter` is never called with the preset relation.

- [ ] **Step 3: Implement in `BookScreen`**

In `web/src/screens/BookScreen.tsx`:

3a. Add `linkedTo` to the modal state type:

```tsx
  const [modal, setModal] = useState<{ mode: "create" | "edit"; character?: Character; linkedTo?: string } | null>(null);
```

3b. Extract a shared `saveCharacter` helper and route both `submit` and the new `submitAndCreateLinked` through it. Replace the existing `submit` function:

```tsx
  const submit = async (input: CharacterInput, avatar: AvatarChange) => {
    const saved = modal?.mode === "edit" && modal.character
      ? await api.updateCharacter(modal.character.id, input)
      : await api.createCharacter(bookId!, input);
    try {
      if (avatar.kind === "set") await api.setAvatar(saved.id, avatar.blob);
      else if (avatar.kind === "remove") await api.deleteAvatar(saved.id);
    } catch (e) {
      console.error("avatar update failed", e);
    }
    setModal(null);
    await refresh();
  };
```

with:

```tsx
  const saveCharacter = async (input: CharacterInput, avatar: AvatarChange) => {
    const saved = modal?.mode === "edit" && modal.character
      ? await api.updateCharacter(modal.character.id, input)
      : await api.createCharacter(bookId!, input);
    try {
      if (avatar.kind === "set") await api.setAvatar(saved.id, avatar.blob);
      else if (avatar.kind === "remove") await api.deleteAvatar(saved.id);
    } catch (e) {
      console.error("avatar update failed", e);
    }
    return saved;
  };

  const submit = async (input: CharacterInput, avatar: AvatarChange) => {
    await saveCharacter(input, avatar);
    setModal(null);
    await refresh();
  };

  // «Новый персонаж»: save A now, refresh so A is selectable, then open a fresh
  // create form pre-linked to A. B's own save creates the A↔B edge via reconcile.
  const submitAndCreateLinked = async (input: CharacterInput, avatar: AvatarChange) => {
    const saved = await saveCharacter(input, avatar);
    await refresh();
    setModal({ mode: "create", linkedTo: saved.id });
  };
```

3c. Wire the new props on `CharacterModal` and add the remount `key`. Replace the `CharacterModal` JSX block:

```tsx
      {modal && (
        <CharacterModal
          open
          mode={modal.mode}
          others={others}
          characterId={modal.character?.id}
          avatarUpdatedAt={modal.character?.avatarUpdatedAt}
          initial={initial}
          onCancel={() => setModal(null)}
          onSubmit={submit}
          onDelete={modal.mode === "edit" ? remove : undefined}
        />
      )}
```

with:

```tsx
      {modal && (
        <CharacterModal
          key={`${modal.mode}:${modal.character?.id ?? modal.linkedTo ?? "new"}`}
          open
          mode={modal.mode}
          others={others}
          characterId={modal.character?.id}
          avatarUpdatedAt={modal.character?.avatarUpdatedAt}
          initial={initial}
          presetRelations={modal.linkedTo ? [{ otherId: modal.linkedTo, role: "", color: null }] : undefined}
          onCancel={() => setModal(null)}
          onSubmit={submit}
          onCreateLinked={submitAndCreateLinked}
          onDelete={modal.mode === "edit" ? remove : undefined}
        />
      )}
```

Note: `initial` stays as-is (built only for `modal.character`); the linked create form is seeded via `presetRelations`, so `gender` starts empty as in a normal create.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace web -- BookScreen`
Expected: PASS (existing BookScreen tests + the new linked-character test).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no output (exit 0). (Confirms exactly one `submit` remains and the `RelationConnection` literal type-checks — import already present transitively via `CharacterInput`; if `tsc` reports `RelationConnection` is not imported in `BookScreen.tsx`, add `import type { ... } from "../types.js"` — but the inline object literal needs no named import.)

- [ ] **Step 6: Commit**

```bash
git add web/src/screens/BookScreen.tsx web/src/screens/__tests__/BookScreen.test.tsx
git commit -m "feat(web): create-and-link a new character from relations"
```

---

### Task 5: Полный прогон тестов и документация

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full web test suite**

Run: `npm run test --workspace web`
Expected: PASS (all web tests green).

- [ ] **Step 2: Run the full server suite (sanity — no server change, must stay green)**

Run: `npm run test --workspace server`
Expected: PASS (unchanged; the relations wire shape was not touched).

- [ ] **Step 3: Final typecheck**

Run: `npx tsc --noEmit -p web/tsconfig.json`
Expected: no output (exit 0).

- [ ] **Step 4: Document the feature in `CLAUDE.md`**

Add a new paragraph to the architecture section (after the **Character comments** paragraph), verbatim:

```markdown
**Link to a new character** — in `RelationsModal`, the «+ Добавить связь» button (now always shown, even when there is no one left to link to) opens `LinkChoiceDialog` («Создать нового персонажа или связать с существующим?»). «Существующий» opens the usual character `Menu` (disabled in the choice when `available.length === 0`); «Новый персонаж» calls `onCreateNew(rows)` with the current staged rows. `CharacterModal` commits those rows, validates, and calls `onCreateLinked(input, avatar)` instead of `onSubmit`. `BookScreen.submitAndCreateLinked` saves character A immediately (via shared `saveCharacter`), refreshes, then opens a fresh create modal with `linkedTo = A.id`; the modal is seeded by the new `presetRelations` prop (so `gender` starts empty), and a `key={mode}:{id|linkedTo|new}` forces a remount on the A→B transition so the form resets. B's own save creates the canonical A↔B edge via the existing reconcile (no new server API; relations wire shape unchanged). Cancelling B leaves A saved without the link — an accepted trade-off of saving A up front.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document link-to-new-character feature"
```

---

## Self-Review notes

- **Spec coverage:** развилка при «+ Добавить связь» (Task 2), «Существующий» = текущая логика + disabled при пустом списке (Task 1/2), «Новый персонаж» → сохранение A + форма B с предзаданной связью (Task 3/4), рекурсия B→C работает «бесплатно» (B — обычный `CharacterModal` с тем же `onCreateLinked`/`presetRelations`, Task 4), нет других персонажей → кнопка видна, «Существующий» disabled (Task 2), Back закрывает развилку (Task 1, `useBackClose`), отмена B оставляет A сохранённым (документировано, Task 5), дубль связи невозможен (серверный `@@unique` — без изменений). Тесты: `LinkChoiceDialog` (Task 1), `RelationsModal` (Task 2), `BookScreen`-поток (Task 4).
- **Type consistency:** `onCreateNew(rows: RelationConnection[])` (Task 2) ⇄ `createLinked(rows)` → `onCreateLinked(input, avatar)` (Task 3) ⇄ `submitAndCreateLinked(input, avatar)` (Task 4). `presetRelations?: RelationConnection[]` (Task 3) ⇄ `presetRelations={... }` (Task 4). `saveCharacter` returns the saved `Character`; `submitAndCreateLinked` reads `saved.id`.
- **Placeholders:** none — every code step shows full code.
- **Out of scope:** запрос роли/цвета в потоке, любые серверные изменения.
