import { expect, test } from "vitest";
import { scaleForDegree, edgeLengthForScales } from "../layout.js";

test("scaleForDegree grows by 0.5 per edge from a baseline of 1.0", () => {
  expect(scaleForDegree(0)).toBe(1.0);
  expect(scaleForDegree(1)).toBe(1.5);
  expect(scaleForDegree(2)).toBe(2.0);
  expect(scaleForDegree(3)).toBe(2.5);
});

test("scaleForDegree caps at 3.0 (reached at 4 edges)", () => {
  expect(scaleForDegree(4)).toBe(3.0);
  expect(scaleForDegree(6)).toBe(3.0);
  expect(scaleForDegree(20)).toBe(3.0);
});

test("edgeLengthForScales averages the two endpoint scales over the base length", () => {
  // base = BASE_EDGE_LENGTH(50) * SPACING_FACTOR(5) = 250
  expect(edgeLengthForScales(1, 1)).toBe(250);
  expect(edgeLengthForScales(1.5, 1.5)).toBe(375);
  expect(edgeLengthForScales(3.0, 1.5)).toBe(562.5);
});
