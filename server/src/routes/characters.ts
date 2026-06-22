import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { reconcileRelationships } from "../services/relationships.js";
import { reconcileComments } from "../services/comments.js";
import { characterCreateSchema, characterUpdateSchema, positionSchema, avatarUploadSchema, AVATAR_MAX_BYTES } from "../schemas.js";
import { bookOwnedBy, characterBookOwnedBy } from "../ownership.js";

export async function characterRoutes(app: FastifyInstance) {
  app.post("/api/characters", async (req, reply) => {
    const parsed = characterCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await bookOwnedBy(req.user!.id, parsed.data.bookId))) return reply.code(404).send({ error: "not found" });
    const { bookId, relations, comments, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.create({ data: { bookId, ...fields } });
      await reconcileRelationships(tx, bookId, c.id, relations);
      await reconcileComments(tx, c.id, comments);
      return c;
    });
    return reply.code(201).send(character);
  });

  app.patch<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    if (!(await characterBookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    const parsed = characterUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { relations, comments, ...fields } = parsed.data;
    const character = await prisma.$transaction(async (tx) => {
      const c = await tx.character.update({ where: { id: req.params.id }, data: fields });
      await reconcileRelationships(tx, c.bookId, c.id, relations);
      await reconcileComments(tx, c.id, comments);
      return c;
    });
    return character;
  });

  app.patch<{ Params: { id: string } }>("/api/characters/:id/pos", async (req, reply) => {
    if (!(await characterBookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    const parsed = positionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return prisma.character.update({ where: { id: req.params.id }, data: parsed.data });
  });

  app.put<{ Params: { id: string } }>("/api/characters/:id/avatar", { bodyLimit: 4 * 1024 * 1024 /* base64 of a ~2 MB image is ~2.7 MB; 4 MB body limit gives headroom over the global 1 MB default */ }, async (req, reply) => {
    const parsed = avatarUploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const buf = Buffer.from(parsed.data.data, "base64");
    if (buf.byteLength > AVATAR_MAX_BYTES) return reply.code(400).send({ error: "avatar too large" });
    if (!(await characterBookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });

    // mimeType is client-declared; the image is validated and baked client-side before upload
    const { width, height, mimeType } = parsed.data;
    await prisma.characterAvatar.upsert({
      where: { characterId: req.params.id },
      create: { characterId: req.params.id, data: buf, mimeType, width, height },
      update: { data: buf, mimeType, width, height },
    });
    return reply.code(200).send({ ok: true });
  });

  app.get<{ Params: { id: string } }>("/api/characters/:id/avatar", async (req, reply) => {
    if (!(await characterBookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    const avatar = await prisma.characterAvatar.findUnique({ where: { characterId: req.params.id } });
    if (!avatar) return reply.code(404).send({ error: "not found" });
    return reply
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .type(avatar.mimeType)
      .send(avatar.data);
  });

  app.delete<{ Params: { id: string } }>("/api/characters/:id/avatar", async (req, reply) => {
    if (!(await characterBookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    await prisma.characterAvatar.deleteMany({ where: { characterId: req.params.id } });
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    if (!(await characterBookOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    await prisma.character.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
