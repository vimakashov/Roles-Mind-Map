import type { Relationship, RelationConnection } from "../types.js";

/**
 * All undirected connections incident to `characterId` (either endpoint).
 * `otherId` is the opposite node, so connections created "from the other side"
 * are visible too. Edges arrive sorted by createdAt -> stable order.
 */
export function incidentConnections(characterId: string, edges: Relationship[]): RelationConnection[] {
  const out: RelationConnection[] = [];
  for (const e of edges) {
    if (e.sourceId === characterId) out.push({ otherId: e.targetId, role: e.role, color: e.color ?? null });
    else if (e.targetId === characterId) out.push({ otherId: e.sourceId, role: e.role, color: e.color ?? null });
  }
  return out;
}
