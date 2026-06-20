import type { Prisma } from "@prisma/client";
import type { RelationEntry } from "../schemas.js";

type Tx = Prisma.TransactionClient;

const key = (targetId: string, role: string) => `${targetId} ${role}`;

/**
 * Makes the relationships for `sourceId` exactly match `entries`.
 * Each entry expands to one row per target. Self-targets are ignored.
 * Applies the minimal set of creates/deletes/updates.
 */
export async function reconcileRelationships(
  tx: Tx,
  bookId: string,
  sourceId: string,
  entries: RelationEntry[],
): Promise<void> {
  const desired = new Map<string, { targetId: string; role: string; color: string | null }>();
  for (const entry of entries) {
    const role = entry.role.trim();
    for (const t of entry.targets) {
      if (t.id === sourceId) continue;
      desired.set(key(t.id, role), { targetId: t.id, role, color: t.color });
    }
  }

  const existing = await tx.relationship.findMany({ where: { sourceId } });
  const existingByKey = new Map(existing.map((r) => [key(r.targetId, r.role), r]));

  const toDelete = existing.filter((r) => !desired.has(key(r.targetId, r.role)));
  if (toDelete.length > 0) {
    await tx.relationship.deleteMany({
      where: { id: { in: toDelete.map((r) => r.id) } },
    });
  }

  const toCreate = [...desired.entries()]
    .filter(([k]) => !existingByKey.has(k))
    .map(([, v]) => ({ bookId, sourceId, targetId: v.targetId, role: v.role, color: v.color }));
  if (toCreate.length > 0) {
    await tx.relationship.createMany({ data: toCreate });
  }

  for (const [k, v] of desired) {
    const ex = existingByKey.get(k);
    if (ex && ex.color !== v.color) {
      await tx.relationship.update({ where: { id: ex.id }, data: { color: v.color } });
    }
  }
}
