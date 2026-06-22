import Fastify, { type FastifyInstance } from "fastify";
import { bookRoutes } from "./routes/books.js";
import { characterRoutes } from "./routes/characters.js";
import { relationshipRoutes } from "./routes/relationships.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
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
