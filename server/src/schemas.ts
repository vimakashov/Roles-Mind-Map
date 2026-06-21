import { z } from "zod";

const name30 = z.string().trim().min(1).max(30);
const title60 = z.string().trim().min(1).max(60);

export const bookCreateSchema = z.object({ title: title60 });
export const bookUpdateSchema = z.object({ title: title60 });

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const relationConnectionSchema = z.object({
  otherId: z.string().min(1),
  role: z.string().trim().max(30).optional().default(""),
  color: hexColor.nullable(),
});

export const characterCreateSchema = z.object({
  bookId: z.string().min(1),
  gender: z.enum(["male", "female"]),
  firstName: name30,
  lastName: name30.optional().nullable(),
  middleName: name30.optional().nullable(),
  age: z.number().int().min(0).max(100).optional().nullable(),
  relations: z.array(relationConnectionSchema).default([]),
});

export const characterUpdateSchema = characterCreateSchema.omit({ bookId: true });

export const positionSchema = z.object({
  posX: z.number(),
  posY: z.number(),
});

export type RelationConnection = z.infer<typeof relationConnectionSchema>;
export type CharacterCreate = z.infer<typeof characterCreateSchema>;
export type CharacterUpdate = z.infer<typeof characterUpdateSchema>;

export const AVATAR_MIME = "image/webp";
export const AVATAR_MAX_DIM = 1024;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const avatarUploadSchema = z.object({
  data: z.string().min(1),
  mimeType: z.literal(AVATAR_MIME),
  width: z.number().int().positive().max(AVATAR_MAX_DIM),
  height: z.number().int().positive().max(AVATAR_MAX_DIM),
});

export type AvatarUpload = z.infer<typeof avatarUploadSchema>;
