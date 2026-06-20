import { expect, test } from "vitest";
import { groupEdges, expandEntries } from "../relations.js";
import type { Relationship } from "../../types.js";

const edge = (
  sourceId: string, targetId: string, role: string, color: string | null = null,
): Relationship => ({
  id: `${sourceId}-${targetId}-${role}`, bookId: "b", sourceId, targetId, role, color,
});

test("groups a source's edges by role, carrying each target's colour", () => {
  const edges = [
    edge("v", "p", "сын", "#ff0000"),
    edge("v", "z", "сын"),
    edge("v", "e", "муж"),
  ];
  const entries = groupEdges("v", edges);
  expect(entries).toEqual([
    { role: "сын", targets: [{ id: "p", color: "#ff0000" }, { id: "z", color: null }] },
    { role: "муж", targets: [{ id: "e", color: null }] },
  ]);
});

test("ignores edges where the character is the target", () => {
  const edges = [edge("x", "v", "друг")];
  expect(groupEdges("v", edges)).toEqual([]);
});

test("expandEntries flattens to (targetId, role, color) triples", () => {
  const pairs = expandEntries([
    { role: "сын", targets: [{ id: "p", color: "#00ff00" }, { id: "z", color: null }] },
  ]);
  expect(pairs).toEqual([
    { targetId: "p", role: "сын", color: "#00ff00" },
    { targetId: "z", role: "сын", color: null },
  ]);
});

test("expandEntries round-trips multiple roles in order", () => {
  const pairs = expandEntries([
    { role: "сын", targets: [{ id: "p", color: null }, { id: "z", color: null }] },
    { role: "муж", targets: [{ id: "e", color: null }] },
  ]);
  expect(pairs).toEqual([
    { targetId: "p", role: "сын", color: null },
    { targetId: "z", role: "сын", color: null },
    { targetId: "e", role: "муж", color: null },
  ]);
});
