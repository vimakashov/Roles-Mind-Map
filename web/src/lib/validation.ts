import { z } from "zod";

const name30 = z.string().trim().min(1, "Обязательное поле").max(30, "Максимум 30 символов");

export const characterFormSchema = z.object({
  gender: z.enum(["male", "female"], { message: "Выберите пол" }),
  firstName: name30,
  lastName: name30,
  middleName: z.string().trim().max(30, "Максимум 30 символов").optional().or(z.literal("")),
  age: z
    .string()
    .optional()
    .refine((v) => v == null || v === "" || /^\d{1,3}$/.test(v), "Только число")
    .refine((v) => v == null || v === "" || (Number(v) >= 0 && Number(v) <= 100), "От 0 до 100"),
});

export type CharacterForm = z.infer<typeof characterFormSchema>;
