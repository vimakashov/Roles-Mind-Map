import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import cola from "cytoscape-cola";
import type { BookGraph } from "../types.js";
import { toElements } from "../lib/graphAdapter.js";
import { GENDER_COLORS, EDGE_COLOR } from "../theme.js";
import {
  SPACING_FACTOR,
  BASE_EDGE_LENGTH,
  BASE_NODE_SPACING,
  POSITION_SCALE,
  BASE_NODE_SIZE,
  BASE_FONT_SIZE,
  edgeLengthForScales,
} from "../lib/layout.js";

cytoscape.use(cola);

interface Props {
  graph: BookGraph;
  onNodeTap: (id: string) => void;
  onNodeMoved: (id: string, x: number, y: number) => void;
  onEdgeTap?: (id: string) => void;
}

export function MindMap({ graph, onNodeTap, onNodeMoved, onEdgeTap }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // The cytoscape instance is only re-created when the node/edge id set changes,
  // so the tap/dragfree handlers bound at init would otherwise capture stale
  // callbacks (e.g. an onNodeTap closing over an outdated graph after an
  // attribute-only edit). Route them through refs that always hold the latest.
  const onNodeTapRef = useRef(onNodeTap);
  const onNodeMovedRef = useRef(onNodeMoved);
  const onEdgeTapRef = useRef(onEdgeTap);
  onNodeTapRef.current = onNodeTap;
  onNodeMovedRef.current = onNodeMoved;
  onEdgeTapRef.current = onEdgeTap;

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
            "background-image": (ele: any) =>
              ele.data("overlayUri")
                ? [ele.data("avatarUri"), ele.data("overlayUri")]
                : ele.data("avatarUri"),
            // Cytoscape's types reject array values for background-fit even though the runtime accepts
            // them for layered background-image; cast to suppress the false-positive TS error.
            "background-fit": (ele: any) => (ele.data("overlayUri") ? ["cover", "cover"] : "cover") as any,
            "border-width": 2,
            "border-color": "#ffffff",
            label: "data(label)",
            "text-wrap": "wrap",
            "text-valign": "bottom",
            "text-margin-y": 6,
            "font-size": (ele: any) => BASE_FONT_SIZE * ele.data("scale"),
            color: "#54413f",
            "text-background-color": "#ffffff",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
            width: (ele: any) => BASE_NODE_SIZE * ele.data("scale"),
            height: (ele: any) => BASE_NODE_SIZE * ele.data("scale"),
          },
        },
        {
          selector: "edge",
          style: {
            label: "data(label)",
            "curve-style": "bezier",
            "target-arrow-shape": "none",
            "line-color": (ele: any) => ele.data("color") || EDGE_COLOR,
            "target-arrow-color": (ele: any) => ele.data("color") || EDGE_COLOR,
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
        edgeLength: (edge: any) =>
          edgeLengthForScales(edge.source().data("scale"), edge.target().data("scale")),
        nodeSpacing: BASE_NODE_SPACING * SPACING_FACTOR,
      } as any,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => onNodeTapRef.current(evt.target.id()));
    cy.on("tap", "edge", (evt) => onEdgeTapRef.current?.(evt.target.id()));
    cy.on("dragfree", "node", (evt) => {
      const p = evt.target.position();
      // Persist in logical space (graphAdapter scales by POSITION_SCALE on load).
      onNodeMovedRef.current(evt.target.id(), p.x / POSITION_SCALE, p.y / POSITION_SCALE);
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
