import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { reconcileRelationships } from "../services/relationships.js";
import { characterCreateSchema, characterUpdateSchema, positionSchema, avatarUploadSchema, AVATAR_MAX_BYTES } from "../schemas.js";

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

  app.put<{ Params: { id: string } }>("/api/characters/:id/avatar", { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const parsed = avatarUploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const buf = Buffer.from(parsed.data.data, "base64");
    if (buf.byteLength > AVATAR_MAX_BYTES) return reply.code(400).send({ error: "avatar too large" });

    const character = await prisma.character.findUnique({ where: { id: req.params.id } });
    if (!character) return reply.code(404).send({ error: "not found" });

    const { width, height, mimeType } = parsed.data;
    await prisma.characterAvatar.upsert({
      where: { characterId: req.params.id },
      create: { characterId: req.params.id, data: buf, mimeType, width, height },
      update: { data: buf, mimeType, width, height },
    });
    return reply.code(200).send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    await prisma.character.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
