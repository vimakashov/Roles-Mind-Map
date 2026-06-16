import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { reconcileRelationships } from "../services/relationships.js";
import { characterCreateSchema, characterUpdateSchema, positionSchema } from "../schemas.js";

export async function characterRoutes(app: FastifyInstance) {
  app.post("/api/characters", async (req, reply) => {
    const parsed = characterCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { bookId, relations, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.create({ data: { bookId, ...fields } });
      await reconcileRelationships(tx, bookId, c.id, relations);
      return c;
    });
    return reply.code(201).send(character);
  });

  app.patch<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    const parsed = characterUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { relations, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.update({ where: { id: req.params.id }, data: fields });
      await reconcileRelationships(tx, c.bookId, c.id, relations);
      return c;
    });
    return character;
  });

  app.patch<{ Params: { id: string } }>("/api/characters/:id/pos", async (req, reply) => {
    const parsed = positionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return prisma.character.update({ where: { id: req.params.id }, data: parsed.data });
  });

  app.delete<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    await prisma.character.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
