import { prisma } from "../db.js";

export async function getBookGraph(bookId: string) {
  const [nodes, edges] = await Promise.all([
    prisma.character.findMany({ where: { bookId }, orderBy: { createdAt: "asc" } }),
    prisma.relationship.findMany({ where: { bookId }, orderBy: { createdAt: "asc" } }),
  ]);
  return { nodes, edges };
}
