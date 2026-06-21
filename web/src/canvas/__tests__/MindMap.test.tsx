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
