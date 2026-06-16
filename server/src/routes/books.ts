import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { DEFAULT_USER_ID } from "../defaultUser.js";
import { bookCreateSchema, bookUpdateSchema } from "../schemas.js";

export async function bookRoutes(app: FastifyInstance) {
  app.get("/api/books", async () =>
    prisma.book.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  );

  app.post("/api/books", async (req, reply) => {
    const parsed = bookCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const count = await prisma.book.count({ where: { userId: DEFAULT_USER_ID } });
    const book = await prisma.book.create({
      data: { userId: DEFAULT_USER_ID, title: parsed.data.title, sortOrder: count },
    });
    return reply.code(201).send(book);
  });

  app.patch<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    const parsed = bookUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const book = await prisma.book.update({ where: { id: req.params.id }, data: parsed.data });
    return book;
  });

  app.delete<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    await prisma.book.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/books/:id/graph", async (req) => {
    const { getBookGraph } = await import("../services/graph.js");
    return getBookGraph(req.params.id);
  });
}
