import type { BookGraph } from "../types.js";
import { api } from "../api/client.js";
import { avatarKey } from "./avatar.js";
import { avatarSvgMarkup, deceasedOverlaySvg } from "./avatarSvg.js";
import { POSITION_SCALE } from "./layout.js";

export interface CyElement {
  data: Record<string, unknown> & { id: string };
  position?: { x: number; y: number };
}

export function toElements(graph: BookGraph): CyElement[] {
  const nodes: CyElement[] = graph.nodes.map((c) => {
    const el: CyElement = {
      data: {
        id: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join("\n"),
        avatar: avatarKey(c.gender, c.age),
        avatarUri: c.avatarUpdatedAt
          ? api.avatarUrl(c.id, c.avatarUpdatedAt)
          : "data:image/svg+xml," + encodeURIComponent(avatarSvgMarkup(c.gender, c.age, { sized: true })),
        overlayUri: c.deceased
          ? "data:image/svg+xml," + encodeURIComponent(deceasedOverlaySvg({ sized: true }))
          : null,
        gender: c.gender,
      },
    };
    if (c.posX != null && c.posY != null)
      el.position = { x: c.posX * POSITION_SCALE, y: c.posY * POSITION_SCALE };
    return el;
  });

  const edges: CyElement[] = graph.edges.map((e) => ({
    data: { id: e.id, source: e.sourceId, target: e.targetId, label: e.role, color: e.color ?? null },
  }));

  return [...nodes, ...edges];
}
