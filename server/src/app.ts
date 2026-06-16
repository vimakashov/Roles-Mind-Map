import Fastify, { type FastifyInstance } from "fastify";
import { bookRoutes } from "./routes/books.js";
import { characterRoutes } from "./routes/characters.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(bookRoutes);
  app.register(characterRoutes);
  return app;
}
