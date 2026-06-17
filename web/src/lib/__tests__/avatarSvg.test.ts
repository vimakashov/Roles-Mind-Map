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

test("head radius reflects the age stage", () => {
  expect(avatarSvgMarkup("female", 8)).toContain('r="18"');  // child: 0.18 * 100
  expect(avatarSvgMarkup("female", 14)).toContain('r="20"'); // teen:  0.20 * 100
  expect(avatarSvgMarkup("female", 30)).toContain('r="22"'); // adult: 0.22 * 100
});
