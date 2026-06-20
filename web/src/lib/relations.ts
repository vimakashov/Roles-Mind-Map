import type { Relationship, RelationEntry, RelationTarget } from "../types.js";

/** Group a single source character's outgoing edges into role-keyed entries (insertion order). */
export function groupEdges(sourceId: string, edges: Relationship[]): RelationEntry[] {
  const byRole = new Map<string, RelationTarget[]>();
  for (const e of edges) {
    if (e.sourceId !== sourceId) continue;
    const list = byRole.get(e.role) ?? [];
    list.push({ id: e.targetId, color: e.color ?? null });
    byRole.set(e.role, list);
  }
  return [...byRole.entries()].map(([role, targets]) => ({ role, targets }));
}

export function expandEntries(
  entries: RelationEntry[],
): { targetId: string; role: string; color: string | null }[] {
  return entries.flatMap((entry) =>
    entry.targets.map((t) => ({ targetId: t.id, role: entry.role, color: t.color })),
  );
}
