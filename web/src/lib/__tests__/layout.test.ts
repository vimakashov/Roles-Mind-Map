import { expect, test } from "vitest";
import { scaleForDegree, edgeScaleForDegree, edgeLengthForScales, edgeLengthForNodes } from "../layout.js";

test("scaleForDegree grows by 0.5 per edge from a baseline of 1.0", () => {
  expect(scaleForDegree(0)).toBe(1.0);
  expect(scaleForDegree(1)).toBe(1.5);
  expect(scaleForDegree(2)).toBe(2.0);
  expect(scaleForDegree(3)).toBe(2.5);
});

test("scaleForDegree is uncapped — grows by 0.5 per edge without limit", () => {
  expect(scaleForDegree(4)).toBe(3.0);
  expect(scaleForDegree(6)).toBe(4.0);
  expect(scaleForDegree(20)).toBe(11.0);
});

test("edgeScaleForDegree grows by only 0.1 per edge from a baseline of 1.0", () => {
  expect(edgeScaleForDegree(0)).toBe(1.0);
  expect(edgeScaleForDegree(1)).toBe(1.1);
  expect(edgeScaleForDegree(2)).toBe(1.2);
  expect(edgeScaleForDegree(5)).toBe(1.5);
});

test("edgeLengthForScales averages the two endpoint scales over the base length", () => {
  // base = BASE_EDGE_LENGTH(50) * SPACING_FACTOR(5) = 250
  expect(edgeLengthForScales(1, 1)).toBe(250);
  expect(edgeLengthForScales(1.5, 1.5)).toBe(375);
  expect(edgeLengthForScales(3.0, 1.5)).toBe(562.5);
});

test("edgeLengthForNodes keeps the gentle length for small nodes", () => {
  // two unconnected-ish leaves (degree 0): gentle = edgeLengthForScales(1,1) = 250;
  // geometric floor = 46*(1+1) + 120 = 212 → gentle wins, edge stays 250.
  expect(edgeLengthForNodes(1.0, 1.0, 1.0, 1.0)).toBe(250);
});

test("edgeLengthForNodes lifts a big node's edges above the gentle length so it doesn't overlap", () => {
  // degree-5 hub (scale 3.5, edgeScale 1.5) ↔ leaf (scale 1.0, edgeScale 1.0):
  // gentle = edgeLengthForScales(1.5,1.0) = 312.5; geometric = 46*(3.5+1.0) + 120 = 327 → floor wins.
  expect(edgeLengthForNodes(3.5, 1.0, 1.5, 1.0)).toBe(327);
  // degree-10 hub ↔ degree-10 hub (scale 6, edgeScale 2.0):
  // gentle = 500; geometric = 46*(6+6) + 120 = 672 → floor wins, far longer.
  expect(edgeLengthForNodes(6.0, 6.0, 2.0, 2.0)).toBe(672);
});
