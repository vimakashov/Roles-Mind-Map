import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword, SESSION_COOKIE, SESSION_MAX_AGE } from "../auth.js";
import { registerSchema, loginSchema } from "../schemas.js";

function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(SESSION_COOKIE, userId, {
    signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
  });
}

/** Case-insensitive lookup (Prisma SQLite has no `mode: "insensitive"`). */
async function findByNameCI(nickname: string) {
  const rows = await prisma.$queryRaw<{ id: string; name: string; passwordHash: string | null }[]>(
    Prisma.sql`SELECT id, name, passwordHash FROM User WHERE LOWER(name) = LOWER(${nickname}) LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { nickname, password } = parsed.data;

    if (await findByNameCI(nickname)) return reply.code(409).send({ error: "nickname taken" });

    const user = await prisma.user.create({
      data: { name: nickname, passwordHash: hashPassword(password) },
      select: { id: true, name: true },
    });
    setSession(reply, user.id);
    return reply.code(201).send(user);
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { nickname, password } = parsed.data;

    const row = await findByNameCI(nickname);
    if (!row || !row.passwordHash || !verifyPassword(password, row.passwordHash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    setSession(reply, row.id);
    return reply.send({ id: row.id, name: row.name });
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthorized" });
    return req.user;
  });
}
