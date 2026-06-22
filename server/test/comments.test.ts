import { beforeAll, beforeEach, expect, test } from "vitest";
import { setupTestDb, resetData, prisma } from "./helpers.js";
import { reconcileComments } from "../src/services/comments.js";
import { commentInputSchema } from "../src/schemas.js";
import { DEFAULT_USER_ID } from "../src/adminUser.js";

beforeAll(() => setupTestDb());
beforeEach(() => resetData());

async function seedCharacter() {
  const book = await prisma.book.create({ data: { userId: DEFAULT_USER_ID, title: "Book" } });
  const character = await prisma.character.create({
    data: { bookId: book.id, gender: "male", firstName: "Vasya", lastName: "X" },
  });
  return { book, character };
}

test("creates a comment from a null-id input", async () => {
  const { character } = await seedCharacter();
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: null, text: "first note" }]),
  );
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe("first note");
});

test("updates text on a matching existing id", async () => {
  const { character } = await seedCharacter();
  const created = await prisma.comment.create({ data: { characterId: character.id, text: "old" } });
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: created.id, text: "new" }]),
  );
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe("new");
});

test("deletes comments absent from the payload", async () => {
  const { character } = await seedCharacter();
  const keep = await prisma.comment.create({ data: { characterId: character.id, text: "keep" } });
  await prisma.comment.create({ data: { characterId: character.id, text: "drop" } });
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: keep.id, text: "keep" }]),
  );
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows.map((r) => r.text)).toEqual(["keep"]);
});

test("an empty payload deletes all comments", async () => {
  const { character } = await seedCharacter();
  await prisma.comment.create({ data: { characterId: character.id, text: "a" } });
  await prisma.$transaction((tx) => reconcileComments(tx, character.id, []));
  const rows = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(rows).toHaveLength(0);
});

test("a foreign id is treated as a new comment, never updates another character's row", async () => {
  const { book, character } = await seedCharacter();
  const other = await prisma.character.create({
    data: { bookId: book.id, gender: "male", firstName: "Petya", lastName: "X" },
  });
  const foreign = await prisma.comment.create({ data: { characterId: other.id, text: "theirs" } });
  await prisma.$transaction((tx) =>
    reconcileComments(tx, character.id, [{ id: foreign.id, text: "mine" }]),
  );
  expect((await prisma.comment.findUnique({ where: { id: foreign.id } }))!.text).toBe("theirs");
  const mine = await prisma.comment.findMany({ where: { characterId: character.id } });
  expect(mine).toHaveLength(1);
  expect(mine[0].text).toBe("mine");
});

test("commentInputSchema rejects empty text and caps at 2000 chars", () => {
  expect(commentInputSchema.safeParse({ id: null, text: "   " }).success).toBe(false);
  expect(commentInputSchema.safeParse({ id: null, text: "a".repeat(2001) }).success).toBe(false);
  expect(commentInputSchema.safeParse({ text: "a".repeat(2000) }).success).toBe(true);
});

test("commentInputSchema defaults id to null when omitted", () => {
  const result = commentInputSchema.safeParse({ text: "note" });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.id).toBeNull();
});
