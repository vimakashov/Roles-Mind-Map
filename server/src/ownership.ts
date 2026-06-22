import { prisma } from "./db.js";

export async function bookOwnedBy(userId: string, bookId: string): Promise<boolean> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { userId: true } });
  return !!book && book.userId === userId;
}

export async function characterBookOwnedBy(userId: string, characterId: string): Promise<boolean> {
  const c = await prisma.character.findUnique({
    where: { id: characterId },
    select: { book: { select: { userId: true } } },
  });
  return !!c && c.book.userId === userId;
}

export async function relationshipOwnedBy(userId: string, relationshipId: string): Promise<boolean> {
  const r = await prisma.relationship.findUnique({
    where: { id: relationshipId },
    select: { book: { select: { userId: true } } },
  });
  return !!r && r.book.userId === userId;
}
