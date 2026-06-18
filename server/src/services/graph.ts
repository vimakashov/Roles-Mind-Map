import { prisma } from "../db.js";

export async function getBookGraph(bookId: string) {
  const [rows, edges] = await Promise.all([
    prisma.character.findMany({
      where: { bookId },
      orderBy: { createdAt: "asc" },
      include: { avatar: { select: { updatedAt: true } } },
    }),
    prisma.relationship.findMany({ where: { bookId }, orderBy: { createdAt: "asc" } }),
  ]);
  const nodes = rows.map(({ avatar, ...c }) => ({
    ...c,
    avatarUpdatedAt: avatar?.updatedAt ?? null,
  }));
  return { nodes, edges };
}
