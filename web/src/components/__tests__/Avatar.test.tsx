import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Avatar } from "../Avatar.js";

test("uses gender color and exposes stage via test id", () => {
  render(<Avatar gender="female" age={70} size={48} />);
  const el = screen.getByTestId("avatar");
  expect(el).toHaveAttribute("data-avatar", "female-old");
});
