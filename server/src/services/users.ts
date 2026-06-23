import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { hashPassword } from "../auth.js";
import { registerSchema } from "../schemas.js";

export class NicknameTakenError extends Error {
  constructor() {
    super("nickname taken");
    this.name = "NicknameTakenError";
  }
}

/** Case-insensitive lookup (Prisma SQLite has no `mode: "insensitive"`). */
export async function findByNameCI(nickname: string) {
  const rows = await prisma.$queryRaw<{ id: string; name: string; passwordHash: string | null }[]>(
    Prisma.sql`SELECT id, name, passwordHash FROM User WHERE LOWER(name) = LOWER(${nickname}) LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** Create a user the same way registration did: validate, CI-unique check, scrypt hash. */
export async function createUser(nickname: string, password: string): Promise<{ id: string; name: string }> {
  const { nickname: n, password: p } = registerSchema.parse({ nickname, password });
  if (await findByNameCI(n)) throw new NicknameTakenError();
  return prisma.user.create({
    data: { name: n, passwordHash: hashPassword(p) },
    select: { id: true, name: true },
  });
}
