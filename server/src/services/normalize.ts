import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";

type RawClient = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

/**
 * Idempotent pre-`db push` migration for the undirected-single-relationship change.
 * Guarded by "the Relationship table exists" so a fresh DB (no table yet) is a no-op.
 * 1) For every unordered pair keep the earliest row by createdAt, delete the rest.
 * 2) Canonicalise survivors so sourceId < targetId.
 * SQLite evaluates all SET RHS against the pre-update row, so the swap is safe.
 */
export async function normalizeRelationships(client: RawClient = prisma): Promise<void> {
  const tables = await client.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='Relationship'`,
  );
  if (tables.length === 0) return;

  await client.$executeRawUnsafe(`
    DELETE FROM "Relationship"
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY MIN("sourceId", "targetId"), MAX("sourceId", "targetId")
          ORDER BY "createdAt" ASC, id ASC
        ) AS rn
        FROM "Relationship"
      ) WHERE rn = 1
    )
  `);

  await client.$executeRawUnsafe(`
    UPDATE "Relationship"
    SET "sourceId" = "targetId", "targetId" = "sourceId"
    WHERE "sourceId" > "targetId"
  `);
}
