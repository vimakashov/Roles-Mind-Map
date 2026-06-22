import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { prisma } from "./db.js";
import { getSessionSecret, SESSION_COOKIE } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { bookRoutes } from "./routes/books.js";
import { characterRoutes } from "./routes/characters.js";
import { relationshipRoutes } from "./routes/relationships.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; name: string };
  }
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(fastifyCookie, { secret: getSessionSecret() });

  // Resolve req.user from the signed session cookie, and gate /api/* (except /api/auth/*).
  app.addHook("preHandler", async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        const user = await prisma.user.findUnique({
          where: { id: unsigned.value },
          select: { id: true, name: true },
        });
        if (user) req.user = user;
      }
    }
    const isApi = req.url.startsWith("/api/");
    const isAuth = req.url.startsWith("/api/auth/");
    if (isApi && !isAuth && !req.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.register(authRoutes);
  app.register(bookRoutes);
  app.register(characterRoutes);
  app.register(relationshipRoutes);
  app.setErrorHandler((err, _req, reply) => {
    if ((err as { code?: string }).code === "P2025") {
      return reply.code(404).send({ error: "not found" });
    }
    reply.send(err);
  });
  return app;
}
