import { expect, test } from "vitest";
import { incidentConnections } from "../relations.js";
import type { Relationship } from "../../types.js";

const edge = (
  id: string, sourceId: string, targetId: string, role: string, color: string | null = null,
): Relationship => ({ id, bookId: "b", sourceId, targetId, role, color });

test("collects a connection where the character is the source", () => {
  const edges = [edge("e1", "v", "p", "друзья", "#ff0000")];
  expect(incidentConnections("v", edges)).toEqual([{ otherId: "p", role: "друзья", color: "#ff0000" }]);
});

test("collects a connection where the character is the target (other side)", () => {
  const edges = [edge("e1", "p", "v", "семья")];
  expect(incidentConnections("v", edges)).toEqual([{ otherId: "p", role: "семья", color: null }]);
});

test("collects connections from both sides, preserving edge order", () => {
  const edges = [edge("e1", "v", "p", "друзья"), edge("e2", "z", "v", "семья")];
  expect(incidentConnections("v", edges)).toEqual([
    { otherId: "p", role: "друзья", color: null },
    { otherId: "z", role: "семья", color: null },
  ]);
});

test("ignores edges that don't touch the character", () => {
  const edges = [edge("e1", "p", "z", "друзья")];
  expect(incidentConnections("v", edges)).toEqual([]);
});
