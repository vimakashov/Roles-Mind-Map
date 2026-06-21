import type { Prisma } from "@prisma/client";
import type { CommentInput } from "../schemas.js";

type Tx = Prisma.TransactionClient;

/**
 * Makes the comments of `characterId` exactly match `comments`.
 * Inputs with a `null` id (or an id not belonging to this character) are created;
 * inputs whose id matches an existing comment update its text; existing comments
 * absent from the payload are deleted. Scoped to the character so ids can't cross.
 */
export async function reconcileComments(
  tx: Tx,
  characterId: string,
  comments: CommentInput[],
): Promise<void> {
  const existing = await tx.comment.findMany({ where: { characterId } });
  const existingById = new Map(existing.map((c) => [c.id, c]));

  const desiredIds = new Set(
    comments
      .filter((c) => c.id != null && existingById.has(c.id))
      .map((c) => c.id as string),
  );

  const toDelete = existing.filter((c) => !desiredIds.has(c.id));
  if (toDelete.length > 0) {
    await tx.comment.deleteMany({ where: { id: { in: toDelete.map((c) => c.id) } } });
  }

  for (const c of comments) {
    const text = c.text.trim();
    const ex = c.id != null ? existingById.get(c.id) : undefined;
    if (ex) {
      if (ex.text !== text) {
        await tx.comment.update({ where: { id: ex.id }, data: { text } });
      }
    } else {
      await tx.comment.create({ data: { characterId, text } });
    }
  }
}
