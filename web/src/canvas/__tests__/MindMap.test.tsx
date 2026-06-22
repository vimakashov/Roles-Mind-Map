import { render } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";
import type { Core } from "cytoscape";
import { MindMap } from "../MindMap.js";
import type { BookGraph } from "../../types.js";

// Capture every cytoscape instance MindMap creates so the test can emit events
// against the real (headless) graph, exercising the actual tap wiring.
const instances: Core[] = [];
vi.mock("cytoscape", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const wrapped = ((opts: any) => {
    // jsdom has no 2d canvas; force cytoscape's null renderer. Event delegation
    // (the behaviour under test) is identical to the real canvas renderer.
    const cy = actual.default({ ...opts, renderer: { name: "null" } });
    instances.push(cy);
    return cy;
  }) as any;
  wrapped.use = actual.default.use;
  return { default: wrapped };
});

vi.mock("../../api/client.js", () => ({
  api: { avatarUrl: (id: string, v: string) => `/api/characters/${id}/avatar?v=${v}` },
}));

beforeEach(() => { instances.length = 0; });

const graphV0: BookGraph = {
  nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30 }],
  edges: [],
};
// Same node id set, but the avatar attribute changed (no add/remove).
const graphV1: BookGraph = {
  nodes: [{ ...graphV0.nodes[0], avatarUpdatedAt: "2026-06-18T00:00:00.000Z" }],
  edges: [],
};

test("tapping a node calls the latest onNodeTap after an attribute-only graph update", () => {
  const tapV0 = vi.fn();
  const tapV1 = vi.fn();
  const noop = vi.fn();

  const { rerender } = render(
    <MindMap graph={graphV0} onNodeTap={tapV0} onNodeMoved={noop} />,
  );
  // Attribute-only change keeps the node id set, so MindMap does not re-init
  // cytoscape; the tap handler must still reach the fresh callback.
  rerender(<MindMap graph={graphV1} onNodeTap={tapV1} onNodeMoved={noop} />);

  const cy = instances[0];
  cy.getElementById("c1").emit("tap");

  expect(tapV1).toHaveBeenCalledWith("c1");
  expect(tapV0).not.toHaveBeenCalled();
});

test("renders edges without an arrowhead (undirected)", () => {
  const graph: BookGraph = {
    nodes: [
      { id: "c1", bookId: "b1", gender: "male", firstName: "A", lastName: "X" },
      { id: "c2", bookId: "b1", gender: "female", firstName: "B", lastName: "Y" },
    ],
    edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null }],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} />);
  const cy = instances[0];
  expect(cy.getElementById("e1").style("target-arrow-shape")).toBe("none");
});

test("a deceased node layers the overlay into its background-image", () => {
  const graph: BookGraph = {
    nodes: [
      { id: "dead", bookId: "b1", gender: "male", firstName: "A", lastName: "X", deceased: true },
      { id: "alive", bookId: "b1", gender: "female", firstName: "B", lastName: "Y" },
    ],
    edges: [],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} />);
  const cy = instances[0];
  expect(String(cy.getElementById("dead").style("background-image"))).toContain("deceased");
  expect(String(cy.getElementById("alive").style("background-image"))).not.toContain("deceased");
});

test("un-marking deceased clears the overlay via in-place sync (no id-set change)", () => {
  const noop = vi.fn();
  // Initial render: node "x" is deceased — overlay must be present.
  const graphDeceased: BookGraph = {
    nodes: [{ id: "x", bookId: "b1", gender: "male", firstName: "A", lastName: "X", deceased: true }],
    edges: [],
  };
  const { rerender } = render(
    <MindMap graph={graphDeceased} onNodeTap={noop} onNodeMoved={noop} />,
  );
  const cy = instances[0];
  expect(String(cy.getElementById("x").style("background-image"))).toContain("deceased");

  // Re-render with the same node id but deceased: false — id set unchanged, so
  // only the in-place data-sync effect runs (no Cytoscape re-init).
  const graphAlive: BookGraph = {
    nodes: [{ id: "x", bookId: "b1", gender: "male", firstName: "A", lastName: "X", deceased: false }],
    edges: [],
  };
  rerender(<MindMap graph={graphAlive} onNodeTap={noop} onNodeMoved={noop} />);

  // The same cy instance must reflect the cleared overlay.
  expect(String(cy.getElementById("x").style("background-image"))).not.toContain("deceased");
});

test("scales node width and name font-size by the node's scale", () => {
  // hub c1 ↔ c2,c3,c4,c5 → degree 4 → scale 3.0; leaf c2 → degree 1 → scale 1.5
  const graph: BookGraph = {
    nodes: [
      { id: "c1", bookId: "b1", gender: "female", firstName: "Анна" },
      { id: "c2", bookId: "b1", gender: "male", firstName: "А" },
      { id: "c3", bookId: "b1", gender: "male", firstName: "Б" },
      { id: "c4", bookId: "b1", gender: "male", firstName: "В" },
      { id: "c5", bookId: "b1", gender: "male", firstName: "Г" },
    ],
    edges: [
      { id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "", color: null },
      { id: "e2", bookId: "b1", sourceId: "c1", targetId: "c3", role: "", color: null },
      { id: "e3", bookId: "b1", sourceId: "c1", targetId: "c4", role: "", color: null },
      { id: "e4", bookId: "b1", sourceId: "c1", targetId: "c5", role: "", color: null },
    ],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} />);
  const cy = instances[0];
  const hub = cy.getElementById("c1");
  const leaf = cy.getElementById("c2");
  expect(parseFloat(hub.style("width"))).toBe(46 * 3.0); // 138
  expect(parseFloat(hub.style("font-size"))).toBe(11 * 3.0); // 33
  expect(parseFloat(leaf.style("width"))).toBe(46 * 1.5); // 69
  expect(parseFloat(leaf.style("font-size"))).toBe(11 * 1.5); // 16.5
});

test("tapping an edge calls onEdgeTap with the edge id", () => {
  const edgeTap = vi.fn();
  const graph: BookGraph = {
    nodes: [
      { id: "c1", bookId: "b1", gender: "male", firstName: "A", lastName: "X" },
      { id: "c2", bookId: "b1", gender: "female", firstName: "B", lastName: "Y" },
    ],
    edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null }],
  };
  render(<MindMap graph={graph} onNodeTap={vi.fn()} onNodeMoved={vi.fn()} onEdgeTap={edgeTap} />);
  const cy = instances[0];
  cy.getElementById("e1").emit("tap");
  expect(edgeTap).toHaveBeenCalledWith("e1");
});
