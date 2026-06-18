import { expect, test } from "vitest";
import { toElements } from "../graphAdapter.js";
import type { BookGraph } from "../../types.js";

const graph: BookGraph = {
  nodes: [
    { id: "v", bookId: "b", gender: "male", firstName: "Вася", lastName: "В", age: 30, posX: 10, posY: 20 },
    { id: "p", bookId: "b", gender: "male", firstName: "Петя", lastName: "П", age: 70 },
  ],
  edges: [{ id: "e1", bookId: "b", sourceId: "v", targetId: "p", role: "сын" }],
};

test("maps nodes with label, avatar key and saved position", () => {
  const els = toElements(graph);
  const vNode = els.find((e) => e.data.id === "v")!;
  expect(vNode.data.label).toBe("Вася\nВ");
  expect(vNode.data.avatar).toBe("male-adult");
  expect(vNode.data.avatarUri as string).toContain("data:image/svg+xml,");
  expect(vNode.position).toEqual({ x: 10, y: 20 });
});

test("nodes without saved position have no position field", () => {
  const els = toElements(graph);
  const pNode = els.find((e) => e.data.id === "p")!;
  expect(pNode.position).toBeUndefined();
});

test("maps edges with role label and source/target", () => {
  const els = toElements(graph);
  const edge = els.find((e) => e.data.id === "e1")!;
  expect(edge.data).toMatchObject({ source: "v", target: "p", label: "сын" });
});

test("node with posX set but posY null has no position field", () => {
  const g: BookGraph = {
    nodes: [{ id: "x", bookId: "b", gender: "female", firstName: "А", lastName: "Б", posX: 5, posY: null }],
    edges: [],
  };
  const els = toElements(g);
  expect(els[0].position).toBeUndefined();
});

test("node with empty lastName produces a trimmed label (no trailing space)", () => {
  const g: BookGraph = {
    nodes: [{ id: "y", bookId: "b", gender: "female", firstName: "Анна", lastName: "" }],
    edges: [],
  };
  const els = toElements(g);
  expect(els[0].data.label).toBe("Анна");
});

test("node with avatarUpdatedAt points avatarUri at the avatar endpoint", () => {
  const g: BookGraph = {
    nodes: [{ id: "c1", bookId: "b", gender: "male", firstName: "Я", lastName: "Я", avatarUpdatedAt: "2026-06-18T00:00:00.000Z" }],
    edges: [],
  };
  const node = toElements(g)[0];
  expect(node.data.avatarUri).toBe("/api/characters/c1/avatar?v=2026-06-18T00%3A00%3A00.000Z");
});

test("node without avatarUpdatedAt keeps the schematic data URI", () => {
  const g: BookGraph = {
    nodes: [{ id: "c1", bookId: "b", gender: "male", firstName: "Я", lastName: "Я", avatarUpdatedAt: null }],
    edges: [],
  };
  const node = toElements(g)[0];
  expect(node.data.avatarUri as string).toContain("data:image/svg+xml,");
});
