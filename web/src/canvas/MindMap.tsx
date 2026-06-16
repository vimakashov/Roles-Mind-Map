import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import cola from "cytoscape-cola";
import type { BookGraph } from "../types.js";
import { toElements } from "../lib/graphAdapter.js";
import { GENDER_COLORS, EDGE_COLOR } from "../theme.js";

cytoscape.use(cola);

interface Props {
  graph: BookGraph;
  onNodeTap: (id: string) => void;
  onNodeMoved: (id: string, x: number, y: number) => void;
}

export function MindMap({ graph, onNodeTap, onNodeMoved }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements: toElements(graph),
      style: [
        {
          selector: "node",
          style: {
            "background-color": (ele: any) => GENDER_COLORS[ele.data("gender") as "male" | "female"],
            label: "data(label)",
            "text-valign": "bottom",
            "text-margin-y": 6,
            "font-size": 11,
            color: "#54413f",
            width: 46,
            height: 46,
          },
        },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": EDGE_COLOR,
            "target-arrow-color": EDGE_COLOR,
            width: 2,
            "font-size": 9,
            color: "#7a5a5a",
            "text-background-color": "#ffffff",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
          },
        },
      ],
      layout: { name: "cola", animate: true, infinite: true, fit: false } as any,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => onNodeTap(evt.target.id()));
    cy.on("dragfree", "node", (evt) => {
      const p = evt.target.position();
      onNodeMoved(evt.target.id(), p.x, p.y);
    });

    return () => { cy.destroy(); cyRef.current = null; };
    // Re-init when the set of node/edge ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes.map((n) => n.id).join(","), graph.edges.map((e) => e.id).join(",")]);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
