import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";

test("hashPassword produces a salt:hash string that verifies", () => {
  const stored = hashPassword("6629");
  expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  expect(verifyPassword("6629", stored)).toBe(true);
});

test("verifyPassword rejects the wrong password", () => {
  const stored = hashPassword("6629");
  expect(verifyPassword("6628", stored)).toBe(false);
});

test("verifyPassword returns false for malformed stored value", () => {
  expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
});

test("two hashes of the same password differ (random salt)", () => {
  expect(hashPassword("abc")).not.toBe(hashPassword("abc"));
});
