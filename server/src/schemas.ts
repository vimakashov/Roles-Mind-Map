import { z } from "zod";

const name30 = z.string().trim().min(1).max(30);

export const bookCreateSchema = z.object({ title: name30 });
export const bookUpdateSchema = z.object({ title: name30 });

export const relationEntrySchema = z.object({
  role: name30,
  targetIds: z.array(z.string().min(1)),
});

export const characterCreateSchema = z.object({
  bookId: z.string().min(1),
  gender: z.enum(["male", "female"]),
  firstName: name30,
  lastName: name30,
  middleName: name30.optional().nullable(),
  age: z.number().int().min(0).max(100).optional().nullable(),
  relations: z.array(relationEntrySchema).default([]),
});

export const characterUpdateSchema = characterCreateSchema.omit({ bookId: true });

export const positionSchema = z.object({
  posX: z.number(),
  posY: z.number(),
});

export type RelationEntry = z.infer<typeof relationEntrySchema>;
export type CharacterCreate = z.infer<typeof characterCreateSchema>;
export type CharacterUpdate = z.infer<typeof characterUpdateSchema>;
