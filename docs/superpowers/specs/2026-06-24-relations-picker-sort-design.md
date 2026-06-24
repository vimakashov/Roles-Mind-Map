# Sort the relations character-picker dropdown

## Problem

In `RelationsModal` (`web/src/components/RelationsModal.tsx`), the «+ Добавить связь» →
«Существующий» flow opens a `Menu` listing characters available to link to
(`available.map(...)`). That list is rendered in the raw order of the `others`
prop — effectively unsorted. Users want it alphabetised.

## Requirement

Sort the dropdown so that:

1. **Latin-script names come first**, ordered **descending** (Z → A).
2. **Cyrillic-script names come second**, ordered **descending** (Я → А).

Sort key is the **full display name** `«Имя Фамилия»` — the exact string the
`Menu` item already renders — so the visible order matches the sort order.

## Design

### Pure helper

New file `web/src/lib/sortCharacters.ts`, following the project's existing
pure-helper + unit-test convention (`layout.ts`, `avatarSvg.ts`).

```ts
type PickerChar = { firstName: string; lastName: string | null };

const displayName = (c: PickerChar) =>
  `${c.firstName} ${c.lastName ?? ""}`.trim();

// Cyrillic block first char → group 1; everything else → group 0.
const CYRILLIC = /[Ѐ-ӿ]/;
const scriptGroup = (name: string) => (CYRILLIC.test(name.charAt(0)) ? 1 : 0);

export function sortForPicker<T extends PickerChar>(chars: T[]): T[] {
  return [...chars].sort((a, b) => {
    const na = displayName(a);
    const nb = displayName(b);
    const ga = scriptGroup(na);
    const gb = scriptGroup(nb);
    if (ga !== gb) return ga - gb;          // group 0 (Latin) before group 1 (Cyrillic)
    return nb.localeCompare(na);            // descending within group
  });
}
```

- **Non-mutating:** sorts a copy.
- **Display name** is computed identically to the `Menu` render
  (`` `${firstName} ${lastName ?? ""}`.trim() ``).
- **Script grouping:** only the first character of the display name decides the
  group. Cyrillic (`Ѐ`–`ӿ`) → group 1; everything else (Latin, digits,
  punctuation, etc.) → group 0. **Non-letter-leading names bucket with the Latin
  group** (confirmed acceptable).
- **Within-group order:** descending via `b.localeCompare(a)` (default-locale,
  case-insensitive collation).

### Wiring

In `RelationsModal.tsx`, wrap the existing `available` computation:

```ts
const available = sortForPicker(others.filter((o) => !connectedIds.has(o.id)));
```

Nothing else changes — the staged `rows` list, the canvas, and every other
dropdown (e.g. the avatar `Menu`) keep their current behaviour.

## Testing

`web/src/lib/__tests__/sortCharacters.test.ts`:

- Latin block precedes Cyrillic block in the output.
- Descending within the Latin group (e.g. input `Adam, Zoe` → `Zoe, Adam`).
- Descending within the Cyrillic group (e.g. input `Анна, Яна` → `Яна, Анна`).
- A mixed, interleaved input list comes out correctly grouped then descending.
- `lastName: null` is handled (no trailing space, sorts on first name).
- A non-letter-leading name (e.g. starts with a digit) lands in the Latin group.

## Out of scope

- No server / schema / API change.
- No change to any other dropdown or to the staged-rows / canvas ordering.
