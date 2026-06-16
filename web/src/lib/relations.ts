import type { Relationship, RelationEntry } from "../types.js";

/** Group a single source character's outgoing edges into role-keyed entries (insertion order). */
export function groupEdges(sourceId: string, edges: Relationship[]): RelationEntry[] {
  const byRole = new Map<string, string[]>();
  for (const e of edges) {
    if (e.sourceId !== sourceId) continue;
    const list = byRole.get(e.role) ?? [];
    list.push(e.targetId);
    byRole.set(e.role, list);
  }
  return [...byRole.entries()].map(([role, targetIds]) => ({ role, targetIds }));
}

export function expandEntries(entries: RelationEntry[]): { targetId: string; role: string }[] {
  return entries.flatMap((entry) =>
    entry.targetIds.map((targetId) => ({ targetId, role: entry.role })),
  );
}
