import { expect, test } from "vitest";
import { characterFormSchema } from "../validation.js";

const valid = { gender: "male", firstName: "Вася", lastName: "Петров", middleName: "", age: "30" };

test("accepts a valid form", () => {
  expect(characterFormSchema.safeParse(valid).success).toBe(true);
});

test("requires first and last name", () => {
  expect(characterFormSchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
  expect(characterFormSchema.safeParse({ ...valid, lastName: "" }).success).toBe(false);
});

test("caps names at 30 chars", () => {
  expect(characterFormSchema.safeParse({ ...valid, firstName: "x".repeat(31) }).success).toBe(false);
});

test("age must be 0..100 when provided, empty allowed", () => {
  expect(characterFormSchema.safeParse({ ...valid, age: "" }).success).toBe(true);
  expect(characterFormSchema.safeParse({ ...valid, age: "101" }).success).toBe(false);
  expect(characterFormSchema.safeParse({ ...valid, age: "-1" }).success).toBe(false);
});

test("invalid gender enum is rejected", () => {
  expect(characterFormSchema.safeParse({ ...valid, gender: "other" }).success).toBe(false);
});

test("non-numeric age like '3a' is rejected", () => {
  expect(characterFormSchema.safeParse({ ...valid, age: "3a" }).success).toBe(false);
});

test("boundary ages 0 and 100 are accepted", () => {
  expect(characterFormSchema.safeParse({ ...valid, age: "0" }).success).toBe(true);
  expect(characterFormSchema.safeParse({ ...valid, age: "100" }).success).toBe(true);
});
