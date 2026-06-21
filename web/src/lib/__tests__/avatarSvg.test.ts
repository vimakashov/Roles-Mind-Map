import { expect, test } from "vitest";
import { avatarSvgMarkup } from "../avatarSvg.js";
import { GENDER_COLORS } from "../../theme.js";

test("returns a standalone SVG string with xmlns and gender-colour fill", () => {
  const svg = avatarSvgMarkup("male", 30);
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain(GENDER_COLORS.male); // "#7e9bc4"
  expect(svg).toContain('data-avatar="male-adult"');
});

test("omits explicit width/height by default so the inline SVG fills its span at 100%", () => {
  const svg = avatarSvgMarkup("male", 30);
  expect(svg).not.toContain("width=");
  expect(svg).not.toContain("height=");
});

test("emits explicit pixel width/height when sized (deterministic intrinsic size for background-image)", () => {
  const svg = avatarSvgMarkup("male", 30, { sized: true });
  expect(svg).toContain('width="100"');
  expect(svg).toContain('height="100"');
});

test("head radius reflects the age stage", () => {
  expect(avatarSvgMarkup("female", 8)).toContain('r="18"');  // child: 0.18 * 100
  expect(avatarSvgMarkup("female", 14)).toContain('r="20"'); // teen:  0.20 * 100
  expect(avatarSvgMarkup("female", 30)).toContain('r="22"'); // adult: 0.22 * 100
});

import { deceasedOverlaySvg } from "../avatarSvg.js";

test("overlay is a standalone svg carrying the deceased marker", () => {
  const svg = deceasedOverlaySvg();
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('data-overlay="deceased"');
});

test("overlay contains a veil circle and a black X stroke", () => {
  const svg = deceasedOverlaySvg();
  expect(svg).toContain("<circle"); // dimming veil
  expect(svg.toLowerCase()).toContain("#111"); // X stroke colour
});

test("overlay omits explicit width/height by default, includes them when sized", () => {
  expect(deceasedOverlaySvg()).not.toContain("width=");
  expect(deceasedOverlaySvg({ sized: true })).toContain('width="100"');
  expect(deceasedOverlaySvg({ sized: true })).toContain('height="100"');
});
