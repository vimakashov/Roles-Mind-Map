import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { getBookGraph } from "../src/services/graph.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

test("returns nodes and edges for a book", async () => {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "B" } });
  const a = await prisma.character.create({ data: { bookId: book.id, gender: "male", firstName: "A", lastName: "A" } });
  const b = await prisma.character.create({ data: { bookId: book.id, gender: "female", firstName: "B", lastName: "B" } });
  await prisma.relationship.create({ data: { bookId: book.id, sourceId: a.id, targetId: b.id, role: "муж" } });

  const graph = await getBookGraph(book.id);
  expect(graph.title).toBe("B");
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0]).toMatchObject({ sourceId: a.id, targetId: b.id, role: "муж" });
});
