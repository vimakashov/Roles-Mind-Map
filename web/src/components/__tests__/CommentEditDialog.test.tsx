import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CommentEditDialog } from "../CommentEditDialog.js";
import { __resetBackStack } from "../../lib/backStack.js";

test("Save is disabled for empty text and enabled after typing", async () => {
  render(<CommentEditDialog open initialText="" onCancel={() => {}} onSave={() => {}} />);
  const save = screen.getByRole("button", { name: /^сохранить$/i });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByRole("textbox"), "hello");
  expect(save).toBeEnabled();
});

test("returns the typed text on save", async () => {
  const onSave = vi.fn();
  render(<CommentEditDialog open initialText="" onCancel={() => {}} onSave={onSave} />);
  await userEvent.type(screen.getByRole("textbox"), "a note");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith("a note");
});

test("pre-fills the field with the initial text for editing", () => {
  render(<CommentEditDialog open initialText="existing" onCancel={() => {}} onSave={() => {}} />);
  expect(screen.getByRole("textbox")).toHaveValue("existing");
});

test("Back button cancels the editor", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<CommentEditDialog open initialText="" onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
