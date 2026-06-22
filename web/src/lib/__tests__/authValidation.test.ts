import { expect, test } from "vitest";
import { nicknameField, passwordField } from "../validation.js";

test("nickname accepts RU/EN letters and digits, 3-20 chars", () => {
  expect(nicknameField.safeParse("Маша123").success).toBe(true);
  expect(nicknameField.safeParse("ab").success).toBe(false);      // too short
  expect(nicknameField.safeParse("bad name").success).toBe(false); // space
  expect(nicknameField.safeParse("a".repeat(21)).success).toBe(false);
});

test("password accepts 3-30 printable ASCII, rejects spaces", () => {
  expect(passwordField.safeParse("6629").success).toBe(true);
  expect(passwordField.safeParse("p@ss!").success).toBe(true);
  expect(passwordField.safeParse("ab").success).toBe(false);       // too short
  expect(passwordField.safeParse("has space").success).toBe(false);
});
