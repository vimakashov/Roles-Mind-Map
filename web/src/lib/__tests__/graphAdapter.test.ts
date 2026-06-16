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
  expect(vNode.data.label).toBe("Вася В");
  expect(vNode.data.avatar).toBe("male-adult");
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
