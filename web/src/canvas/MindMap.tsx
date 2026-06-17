import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import cola from "cytoscape-cola";
import type { BookGraph } from "../types.js";
import { toElements } from "../lib/graphAdapter.js";
import { GENDER_COLORS, EDGE_COLOR } from "../theme.js";

cytoscape.use(cola);

// Spacing applies to auto-layout only; saved posX/posY are not scaled.
const SPACING_FACTOR = 3;
const BASE_EDGE_LENGTH = 50;
const BASE_NODE_SPACING = 10;

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
            "background-image": "data(avatarUri)",
            "background-fit": "cover",
            "border-width": 2,
            "border-color": "#ffffff",
            label: "data(label)",
            "text-wrap": "wrap",
            "text-valign": "bottom",
            "text-margin-y": 6,
            "font-size": 11,
            color: "#54413f",
            "text-background-color": "#ffffff",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
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
      layout: {
        name: "cola",
        animate: true,
        infinite: true,
        fit: false,
        edgeLength: BASE_EDGE_LENGTH * SPACING_FACTOR,
        nodeSpacing: BASE_NODE_SPACING * SPACING_FACTOR,
      } as any,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => onNodeTap(evt.target.id()));
    cy.on("dragfree", "node", (evt) => {
      const p = evt.target.position();
      onNodeMoved(evt.target.id(), p.x, p.y);
    });

    return () => { cy.destroy(); cyRef.current = null; };
    // Re-init when the set of node/edge ids changes (add/remove).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes.map((n) => n.id).join(","), graph.edges.map((e) => e.id).join(",")]);

  // Sync mutable display data (label, gender→colour, avatar, edge role) into
  // the existing instance when an element is edited but the id set is unchanged.
  // Without this, attribute-only edits (e.g. changing gender) would not appear
  // until a full reload. Updating data in place keeps node positions/layout.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      for (const el of toElements(graph)) {
        const target = cy.getElementById(el.data.id);
        if (target.empty()) continue;
        // id is unchanged; source/target are immutable on existing edges.
        const { id: _id, source: _source, target: _target, ...mutable } = el.data;
        target.data(mutable);
      }
    });
  }, [graph]);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
