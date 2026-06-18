import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Avatar } from "../Avatar.js";

test("uses gender color and exposes stage via test id", () => {
  render(<Avatar gender="female" age={70} size={48} />);
  const el = screen.getByTestId("avatar");
  expect(el).toHaveAttribute("data-avatar", "female-old");
});

test("renders an img with circular mask when src is provided", () => {
  render(<Avatar gender="male" age={30} size={48} src="/api/characters/c1/avatar?v=1" />);
  const el = screen.getByTestId("avatar-img") as HTMLImageElement;
  expect(el.tagName).toBe("IMG");
  expect(el.getAttribute("src")).toBe("/api/characters/c1/avatar?v=1");
});
