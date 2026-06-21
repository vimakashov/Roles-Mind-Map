import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileRelationships } from "../src/services/relationships.js";
import { relationConnectionSchema } from "../src/schemas.js";
import { DEFAULT_USER_ID } from "../src/defaultUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seed() {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "Book" } });
  const mk = (firstName: string) =>
    prisma.character.create({ data: { bookId: book.id, gender: "male", firstName, lastName: "X" } });
  const vasya = await mk("Vasya");
  const petya = await mk("Petya");
  const zhanna = await mk("Zhanna");
  return { book, vasya, petya, zhanna };
}

test("creates a connection stored canonically (sourceId < targetId)", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].sourceId < rows[0].targetId).toBe(true);
  expect(rows[0].role).toBe("друзья");
});

test("a connection created from one side is incident (visible) from the other side", async () => {
  const { book, vasya, petya } = await seed();
  // create from vasya
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  // reconciling petya with the same single connection must NOT duplicate it
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, [{ otherId: vasya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
});

test("does not create a duplicate row for the reverse direction", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  // petya re-asserts the same edge -> still one row
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, [{ otherId: vasya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
});

test("editing the role from the other side updates the same row", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, [{ otherId: vasya.id, role: "враги", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("враги");
});

test("adds and removes incident rows to match the desired set", async () => {
  const { book, vasya, petya, zhanna } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "", color: null }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: zhanna.id, role: "", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  const otherOf = (r: { sourceId: string; targetId: string }) =>
    r.sourceId === vasya.id ? r.targetId : r.sourceId;
  expect(otherOf(rows[0])).toBe(zhanna.id);
});

test("a connection removed from the other side is deleted", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, petya.id, []),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(0);
});

test("drops self-connections", async () => {
  const { book, vasya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: vasya.id, role: "self", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(0);
});

test("persists colour on create", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: "#ff0000" }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows[0].color).toBe("#ff0000");
});

test("stores null colour as default (no colour written)", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows[0].color).toBeNull();
});

test("updates colour when only the colour changes", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: "#111111" }]),
  );
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "друзья", color: "#222222" }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].color).toBe("#222222");
});

test("reconcile stores an empty role as a blank-labelled edge", async () => {
  const { book, vasya, petya } = await seed();
  await prisma.$transaction((tx) =>
    reconcileRelationships(tx, book.id, vasya.id, [{ otherId: petya.id, role: "", color: null }]),
  );
  const rows = await prisma.relationship.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("");
});

test("relationConnectionSchema accepts an empty role (defaults to '')", () => {
  const result = relationConnectionSchema.safeParse({ otherId: "x", color: null });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.role).toBe("");
});

test("relationConnectionSchema rejects an invalid hex colour", () => {
  expect(relationConnectionSchema.safeParse({ otherId: "x", role: "друг", color: "red" }).success).toBe(false);
});

test("relationConnectionSchema accepts a null colour", () => {
  expect(relationConnectionSchema.safeParse({ otherId: "x", role: "друг", color: null }).success).toBe(true);
});
