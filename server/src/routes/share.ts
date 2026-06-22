import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function shareRoutes(app: FastifyInstance) {
  app.get<{ Params: { bookId: string } }>("/api/share/:bookId/graph", async (req, reply) => {
    const book = await prisma.book.findUnique({ where: { id: req.params.bookId }, select: { id: true } });
    if (!book) return reply.code(404).send({ error: "not found" });
    const { getBookGraph } = await import("../services/graph.js");
    return getBookGraph(req.params.bookId);
  });

  app.get<{ Params: { bookId: string; characterId: string } }>(
    "/api/share/:bookId/characters/:characterId/avatar",
    async (req, reply) => {
      const character = await prisma.character.findUnique({
        where: { id: req.params.characterId },
        select: { bookId: true },
      });
      if (!character || character.bookId !== req.params.bookId) {
        return reply.code(404).send({ error: "not found" });
      }
      const avatar = await prisma.characterAvatar.findUnique({ where: { characterId: req.params.characterId } });
      if (!avatar) return reply.code(404).send({ error: "not found" });
      return reply
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .type(avatar.mimeType)
        .send(avatar.data);
    },
  );
}
