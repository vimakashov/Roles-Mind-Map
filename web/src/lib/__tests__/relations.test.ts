import { expect, test } from "vitest";
import { groupEdges, expandEntries } from "../relations.js";
import type { Relationship } from "../../types.js";

const edge = (sourceId: string, targetId: string, role: string): Relationship => ({
  id: `${sourceId}-${targetId}-${role}`, bookId: "b", sourceId, targetId, role,
});

test("groups a source's edges by role", () => {
  const edges = [edge("v", "p", "сын"), edge("v", "z", "сын"), edge("v", "e", "муж")];
  const entries = groupEdges("v", edges);
  expect(entries).toEqual([
    { role: "сын", targetIds: ["p", "z"] },
    { role: "муж", targetIds: ["e"] },
  ]);
});

test("ignores edges where the character is the target", () => {
  const edges = [edge("x", "v", "друг")];
  expect(groupEdges("v", edges)).toEqual([]);
});

test("expandEntries flattens to (targetId, role) pairs", () => {
  const pairs = expandEntries([{ role: "сын", targetIds: ["p", "z"] }]);
  expect(pairs).toEqual([
    { targetId: "p", role: "сын" },
    { targetId: "z", role: "сын" },
  ]);
});

test("expandEntries round-trips multiple roles in order", () => {
  const pairs = expandEntries([
    { role: "сын", targetIds: ["p", "z"] },
    { role: "муж", targetIds: ["e"] },
  ]);
  expect(pairs).toEqual([
    { targetId: "p", role: "сын" },
    { targetId: "z", role: "сын" },
    { targetId: "e", role: "муж" },
  ]);
});
