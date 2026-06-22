import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { relationUpdateSchema } from "../schemas.js";
import { relationshipOwnedBy } from "../ownership.js";

export async function relationshipRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string } }>("/api/relationships/:id", async (req, reply) => {
    const parsed = relationUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (!(await relationshipOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    return prisma.relationship.update({ where: { id: req.params.id }, data: parsed.data });
  });

  app.delete<{ Params: { id: string } }>("/api/relationships/:id", async (req, reply) => {
    if (!(await relationshipOwnedBy(req.user!.id, req.params.id))) return reply.code(404).send({ error: "not found" });
    await prisma.relationship.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
}
