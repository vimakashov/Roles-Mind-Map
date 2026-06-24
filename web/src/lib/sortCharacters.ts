type PickerChar = { firstName: string; lastName?: string | null };

const displayName = (c: PickerChar) => `${c.firstName} ${c.lastName ?? ""}`.trim();

// Cyrillic block (U+0400–U+04FF) leading char -> group 1; everything else -> group 0.
const CYRILLIC = /[Ѐ-ӿ]/;
const scriptGroup = (name: string) => (CYRILLIC.test(name.charAt(0)) ? 1 : 0);

/**
 * Sort characters for the relations picker dropdown: Latin-script display
 * names first (A→Z), then Cyrillic display names (А→Я).
 * Non-mutating — returns a new array.
 */
export function sortForPicker<T extends PickerChar>(chars: T[]): T[] {
  return [...chars].sort((a, b) => {
    const na = displayName(a);
    const nb = displayName(b);
    const ga = scriptGroup(na);
    const gb = scriptGroup(nb);
    if (ga !== gb) return ga - gb; // group 0 (Latin) before group 1 (Cyrillic)
    return na.localeCompare(nb); // ascending within group
  });
}
