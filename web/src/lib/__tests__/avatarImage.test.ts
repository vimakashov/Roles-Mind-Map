import { expect, test } from "vitest";
import {
  validateFileBasics, validateDimensions, ACCEPT_ATTR, MAX_FILE_BYTES, MIN_DIM, MAX_DIM,
} from "../avatarImage.js";

function fileOfType(type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], "a", { type });
}

test("accepts a small png", () => {
  expect(validateFileBasics(fileOfType("image/png"))).toBeNull();
});

test("rejects an unsupported type", () => {
  expect(validateFileBasics(fileOfType("application/pdf"))).toMatch(/формат|тип/i);
});

test("rejects a file over the size cap", () => {
  const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big", { type: "image/png" });
  expect(validateFileBasics(big)).toMatch(/15|МБ|размер/i);
});

test("dimension check passes at the boundaries", () => {
  expect(validateDimensions(MIN_DIM, MIN_DIM)).toBeNull();
  expect(validateDimensions(MAX_DIM, MAX_DIM)).toBeNull();
});

test("dimension check rejects too small and too large", () => {
  expect(validateDimensions(MIN_DIM - 1, MIN_DIM)).toMatch(/64/);
  expect(validateDimensions(MAX_DIM + 1, MAX_DIM)).toMatch(/3000/);
});

test("ACCEPT_ATTR lists the five accepted image types", () => {
  expect(ACCEPT_ATTR).toContain("image/jpeg");
  expect(ACCEPT_ATTR).toContain("image/png");
  expect(ACCEPT_ATTR).toContain("image/gif");
  expect(ACCEPT_ATTR).toContain("image/svg+xml");
  expect(ACCEPT_ATTR).toContain("image/webp");
});
