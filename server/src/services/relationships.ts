import type { Prisma } from "@prisma/client";
import type { RelationConnection } from "../schemas.js";

type Tx = Prisma.TransactionClient;

/**
 * Makes the undirected relationships incident to `characterId` exactly match `connections`.
 * The graph is undirected and stores ONE canonical row per unordered pair
 * (sourceId < targetId). We look at both endpoints so a connection created
 * "from the other side" is seen and never duplicated. Self-connections are ignored.
 */
export async function reconcileRelationships(
  tx: Tx,
  bookId: string,
  characterId: string,
  connections: RelationConnection[],
): Promise<void> {
  const desired = new Map<string, { role: string; color: string | null }>();
  for (const c of connections) {
    if (c.otherId === characterId) continue;
    desired.set(c.otherId, { role: c.role.trim(), color: c.color });
  }

  const existing = await tx.relationship.findMany({
    where: { OR: [{ sourceId: characterId }, { targetId: characterId }] },
  });
  const otherOf = (r: { sourceId: string; targetId: string }) =>
    r.sourceId === characterId ? r.targetId : r.sourceId;
  const existingByOther = new Map(existing.map((r) => [otherOf(r), r]));

  const toDelete = existing.filter((r) => !desired.has(otherOf(r)));
  if (toDelete.length > 0) {
    await tx.relationship.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
  }

  const toCreate = [...desired.entries()]
    .filter(([otherId]) => !existingByOther.has(otherId))
    .map(([otherId, v]) => {
      const [sourceId, targetId] =
        characterId < otherId ? [characterId, otherId] : [otherId, characterId];
      return { bookId, sourceId, targetId, role: v.role, color: v.color };
    });
  if (toCreate.length > 0) {
    await tx.relationship.createMany({ data: toCreate });
  }

  for (const [otherId, v] of desired) {
    const ex = existingByOther.get(otherId);
    if (ex && (ex.role !== v.role || ex.color !== v.color)) {
      await tx.relationship.update({ where: { id: ex.id }, data: { role: v.role, color: v.color } });
    }
  }
}
