import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { LinkChoiceDialog } from "../LinkChoiceDialog.js";

test("calls onExisting when «Существующий» is clicked", async () => {
  const onExisting = vi.fn();
  render(<LinkChoiceDialog open canUseExisting onExisting={onExisting} onCreateNew={() => {}} onCancel={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /существующий/i }));
  expect(onExisting).toHaveBeenCalledTimes(1);
});

test("calls onCreateNew when «Новый персонаж» is clicked", async () => {
  const onCreateNew = vi.fn();
  render(<LinkChoiceDialog open canUseExisting onExisting={() => {}} onCreateNew={onCreateNew} onCancel={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /новый персонаж/i }));
  expect(onCreateNew).toHaveBeenCalledTimes(1);
});

test("disables «Существующий» when there is no one to link to", () => {
  render(<LinkChoiceDialog open canUseExisting={false} onExisting={() => {}} onCreateNew={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole("button", { name: /существующий/i })).toBeDisabled();
});
