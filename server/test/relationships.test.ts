import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileRelationships } from "../src/services/relationships.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seed() {
  const book = await prisma.book.create({
    data: { userId: DEFAULT_USER_ID, title: "Book" },
  });
  const mk = (firstName: string) =>
    prisma.character.create({
      data: { bookId: book.id, gender: "male", firstName, lastName: "X" },
    });
  const vasya = await mk("Vasya");
  const petya = await mk("Petya");
  const zhanna = await mk("Zhanna");
  return { book, vasya, petya, zhanna };
}

test("expands one entry with multiple targets into multiple rows", async () => {
  const { book, vasya, petya, zhanna } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targetIds: [petya.id, zhanna.id] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.role === "сын")).toBe(true);
});

test("adds and removes rows to match desired set", async () => {
  const { book, vasya, petya, zhanna } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targetIds: [petya.id] },
    ]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targetIds: [zhanna.id] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].targetId).toBe(zhanna.id);
});

test("drops self-relations", async () => {
  const { book, vasya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "self", targetIds: [vasya.id] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(0);
});

test("dedupes identical (target, role) pairs across entries", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targetIds: [petya.id] },
      { role: "сын", targetIds: [petya.id] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
});
