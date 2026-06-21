import { prisma } from "../db.js";

export async function getBookGraph(bookId: string) {
  const [book, rows, edges] = await Promise.all([
    prisma.book.findUnique({ where: { id: bookId }, select: { title: true } }),
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
  return { title: book?.title ?? "", nodes, edges };
}
