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

test("Latin group is sorted ascending (A→Z)", () => {
  const input: C[] = [
    { id: "1", firstName: "Zoe", lastName: null },
    { id: "2", firstName: "Adam", lastName: null },
    { id: "3", firstName: "Mia", lastName: null },
  ];
  expect(names(sortForPicker(input))).toEqual(["Adam", "Mia", "Zoe"]);
});

test("Cyrillic group is sorted ascending (А→Я)", () => {
  const input: C[] = [
    { id: "1", firstName: "Яна", lastName: null },
    { id: "2", firstName: "Анна", lastName: null },
    { id: "3", firstName: "Мила", lastName: null },
  ];
  expect(names(sortForPicker(input))).toEqual(["Анна", "Мила", "Яна"]);
});

test("mixed interleaved input is grouped then ascending", () => {
  const input: C[] = [
    { id: "1", firstName: "Мила", lastName: null },
    { id: "2", firstName: "Zoe", lastName: null },
    { id: "3", firstName: "Яна", lastName: null },
    { id: "4", firstName: "Adam", lastName: null },
  ];
  expect(names(sortForPicker(input))).toEqual(["Adam", "Zoe", "Мила", "Яна"]);
});

test("uses full display name including lastName", () => {
  const input: C[] = [
    { id: "1", firstName: "Ivan", lastName: "Zorin" },
    { id: "2", firstName: "Ivan", lastName: "Adams" },
  ];
  expect(names(sortForPicker(input))).toEqual(["Ivan Adams", "Ivan Zorin"]);
});

test("null lastName produces no trailing space and sorts on first name", () => {
  const input: C[] = [
    { id: "1", firstName: "Ben", lastName: null },
    { id: "2", firstName: "Ann", lastName: undefined },
  ];
  expect(names(sortForPicker(input))).toEqual(["Ann", "Ben"]);
});

test("a digit-leading name buckets with the Latin group", () => {
  const input: C[] = [
    { id: "1", firstName: "Анна", lastName: null },
    { id: "2", firstName: "3PO", lastName: null },
    { id: "3", firstName: "Zoe", lastName: null },
  ];
  // Latin group (3PO, Zoe) ascending, then Cyrillic (Анна)
  expect(names(sortForPicker(input))).toEqual(["3PO", "Zoe", "Анна"]);
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
