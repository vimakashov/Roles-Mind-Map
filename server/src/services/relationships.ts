import type { Prisma } from "@prisma/client";
import type { RelationEntry } from "../schemas.js";

type Tx = Prisma.TransactionClient;

const key = (targetId: string, role: string) => `${targetId} ${role}`;

/**
 * Makes the relationships for `sourceId` exactly match `entries`.
 * Each entry expands to one row per target. Self-targets are ignored.
 * Applies the minimal set of creates/deletes.
 */
export async function reconcileRelationships(
  tx: Tx,
  bookId: string,
  sourceId: string,
  entries: RelationEntry[],
): Promise<void> {
  const desired = new Map<string, { targetId: string; role: string }>();
  for (const entry of entries) {
    const role = entry.role.trim();
    for (const targetId of entry.targetIds) {
      if (targetId === sourceId) continue;
      desired.set(key(targetId, role), { targetId, role });
    }
  }

  const existing = await tx.relationship.findMany({ where: { sourceId } });
  const existingKeys = new Set(existing.map((r) => key(r.targetId, r.role)));

  const toDelete = existing.filter((r) => !desired.has(key(r.targetId, r.role)));
  if (toDelete.length > 0) {
    await tx.relationship.deleteMany({
      where: { id: { in: toDelete.map((r) => r.id) } },
    });
  }

  const toCreate = [...desired.entries()]
    .filter(([k]) => !existingKeys.has(k))
    .map(([, v]) => ({ bookId, sourceId, targetId: v.targetId, role: v.role }));
  if (toCreate.length > 0) {
    await tx.relationship.createMany({ data: toCreate });
  }
}
