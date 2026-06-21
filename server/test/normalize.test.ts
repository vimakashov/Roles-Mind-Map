import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { normalizeRelationships } from "../src/services/normalize.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seed() {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "Book" } });
  const mk = (firstName: string) =>
    prisma.character.create({ data: { bookId: book.id, gender: "male", firstName, lastName: "X" } });
  const a = await mk("A");
  const b = await mk("B");
  return { book, a, b };
}

test("collapses a duplicate unordered pair, keeping the earliest, and canonicalises order", async () => {
  const { book, a, b } = await seed();
  const [lo, hi] = [a.id, b.id].sort();
  // earliest row, stored non-canonically (hi -> lo) so we also exercise canonicalisation
  await prisma.relationship.create({
    data: { bookId: book.id, sourceId: hi, targetId: lo, role: "early", createdAt: new Date("2020-01-01T00:00:00Z") },
  });
  // later duplicate in the reverse direction (lo -> hi) -> must be removed
  await prisma.relationship.create({
    data: { bookId: book.id, sourceId: lo, targetId: hi, role: "late", createdAt: new Date("2021-01-01T00:00:00Z") },
  });

  await normalizeRelationships(prisma);

  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("early");
  expect(rows[0].sourceId).toBe(lo);
  expect(rows[0].targetId).toBe(hi);
});

test("is idempotent on already-canonical, unique data", async () => {
  const { book, a, b } = await seed();
  const [lo, hi] = [a.id, b.id].sort();
  await prisma.relationship.create({ data: { bookId: book.id, sourceId: lo, targetId: hi, role: "друзья" } });

  await normalizeRelationships(prisma);
  await normalizeRelationships(prisma);

  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sourceId: lo, targetId: hi, role: "друзья" });
});
