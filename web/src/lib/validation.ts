import { z } from "zod";

const name30 = z.string().trim().min(1, "Обязательное поле").max(30, "Максимум 30 символов");

export const characterFormSchema = z.object({
  gender: z.enum(["male", "female"], { message: "Выберите пол" }),
  firstName: name30,
  lastName: z.string().trim().max(30, "Максимум 30 символов").optional().or(z.literal("")),
  middleName: z.string().trim().max(30, "Максимум 30 символов").optional().or(z.literal("")),
  age: z
    .string()
    .optional()
    .refine((v) => v == null || v === "" || /^\d{1,3}$/.test(v), "Только число")
    .refine((v) => v == null || v === "" || (Number(v) >= 0 && Number(v) <= 100), "От 0 до 100"),
});

export type CharacterForm = z.infer<typeof characterFormSchema>;

export const nicknameField = z
  .string()
  .trim()
  .min(3, "Минимум 3 символа")
  .max(20, "Максимум 20 символов")
  .regex(/^[A-Za-zА-Яа-яЁё0-9]+$/, "Только буквы и цифры");

export const passwordField = z
  .string()
  .min(3, "Минимум 3 символа")
  .max(30, "Максимум 30 символов")
  .regex(/^[\x21-\x7E]+$/, "Недопустимые символы");
