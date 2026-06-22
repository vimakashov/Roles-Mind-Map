import { expect, test } from "vitest";
import { toElements } from "../graphAdapter.js";
import { POSITION_SCALE } from "../layout.js";
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
  expect(vNode.position).toEqual({ x: 10 * POSITION_SCALE, y: 20 * POSITION_SCALE });
});

test("nodes without saved position have no position field", () => {
  const els = toElements(graph);
  const pNode = els.find((e) => e.data.id === "p")!;
  expect(pNode.position).toBeUndefined();
});

test("maps edges with role label, source/target, and null colour by default", () => {
  const els = toElements(graph);
  const edge = els.find((e) => e.data.id === "e1")!;
  expect(edge.data).toMatchObject({ source: "v", target: "p", label: "сын", color: null });
});

test("passes an explicit edge colour through to the element data", () => {
  const g: BookGraph = {
    nodes: graph.nodes,
    edges: [{ id: "e2", bookId: "b", sourceId: "v", targetId: "p", role: "друг", color: "#abcdef" }],
  };
  const edge = toElements(g).find((e) => e.data.id === "e2")!;
  expect(edge.data.color).toBe("#abcdef");
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

test("schematic data URI carries explicit width/height so background-fit cover centres on every browser", () => {
  const g: BookGraph = {
    nodes: [{ id: "c1", bookId: "b", gender: "male", firstName: "Я", lastName: "Я", avatarUpdatedAt: null }],
    edges: [],
  };
  const svg = decodeURIComponent((toElements(g)[0].data.avatarUri as string).replace("data:image/svg+xml,", ""));
  expect(svg).toContain('width="100"');
  expect(svg).toContain('height="100"');
});

test("deceased node carries an encoded overlay data URI", () => {
  const g: BookGraph = {
    nodes: [{ id: "d", bookId: "b", gender: "male", firstName: "Х", lastName: "Х", deceased: true }],
    edges: [],
  };
  const node = toElements(g)[0];
  expect(node.data.overlayUri as string).toContain("data:image/svg+xml,");
  expect(node.data.overlayUri as string).toContain("deceased");
});

test("living node has a null overlay (so the canvas clears a stale overlay)", () => {
  const g: BookGraph = {
    nodes: [{ id: "a", bookId: "b", gender: "male", firstName: "Х", lastName: "Х" }],
    edges: [],
  };
  expect(toElements(g)[0].data.overlayUri).toBeNull();
});

test("emits a per-node scale from its degree, capped, default 1.0 when isolated", () => {
  // hub h ↔ a,b,c,d (degree 4 → capped 3.0); each leaf degree 1 → 1.5; lone z → 1.0
  const g: BookGraph = {
    nodes: [
      { id: "h", bookId: "b", gender: "female", firstName: "Анна" },
      { id: "a", bookId: "b", gender: "male", firstName: "А" },
      { id: "c2", bookId: "b", gender: "male", firstName: "Б" },
      { id: "c3", bookId: "b", gender: "male", firstName: "В" },
      { id: "c4", bookId: "b", gender: "male", firstName: "Г" },
      { id: "z", bookId: "b", gender: "male", firstName: "Один" },
    ],
    edges: [
      { id: "e1", bookId: "b", sourceId: "h", targetId: "a", role: "" },
      { id: "e2", bookId: "b", sourceId: "h", targetId: "c2", role: "" },
      { id: "e3", bookId: "b", sourceId: "h", targetId: "c3", role: "" },
      { id: "e4", bookId: "b", sourceId: "h", targetId: "c4", role: "" },
    ],
  };
  const els = toElements(g);
  const scaleOf = (id: string) => els.find((e) => e.data.id === id)!.data.scale;
  expect(scaleOf("h")).toBe(3.0);
  expect(scaleOf("a")).toBe(1.5);
  expect(scaleOf("z")).toBe(1.0);
});
