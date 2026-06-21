import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileRelationships } from "../src/services/relationships.js";
import { relationEntrySchema } from "../src/schemas.js";
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
      { role: "сын", targets: [{ id: petya.id, color: null }, { id: zhanna.id, color: null }] },
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
      { role: "сын", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targets: [{ id: zhanna.id, color: null }] },
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
      { role: "self", targets: [{ id: vasya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(0);
});

test("dedupes identical (target, role) pairs across entries", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "сын", targets: [{ id: petya.id, color: null }] },
      { role: "сын", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
});

test("persists colour on create", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: "#ff0000" }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows[0].color).toBe("#ff0000");
});

test("stores null colour as default (no colour written)", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows[0].color).toBeNull();
});

test("updates colour when only the colour changes", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: "#111111" }] },
    ]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "друг", targets: [{ id: petya.id, color: "#222222" }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].color).toBe("#222222");
});

test("rejects an invalid hex colour", () => {
  const result = relationEntrySchema.safeParse({
    role: "друг",
    targets: [{ id: "x", color: "red" }],
  });
  expect(result.success).toBe(false);
});

test("accepts a null colour", () => {
  const result = relationEntrySchema.safeParse({
    role: "друг",
    targets: [{ id: "x", color: null }],
  });
  expect(result.success).toBe(true);
});

test("relationEntrySchema accepts an empty role", () => {
  expect(relationEntrySchema.safeParse({ role: "", targets: [] }).success).toBe(true);
});

test("reconcile stores an empty role as a blank-labelled edge", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [
      { role: "", targets: [{ id: petya.id, color: null }] },
    ]),
  );
  const rows = await prisma.relationship.findMany({ where: { sourceId: vasya.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("");
});
