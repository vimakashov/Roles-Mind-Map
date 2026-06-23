import type { FastifyInstance, FastifyReply } from "fastify";
import { verifyPassword, SESSION_COOKIE, SESSION_MAX_AGE } from "../auth.js";
import { loginSchema } from "../schemas.js";
import { findByNameCI } from "../services/users.js";

function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(SESSION_COOKIE, userId, {
    signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
  });
}

export async function authRoutes(app: FastifyInstance) {
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
