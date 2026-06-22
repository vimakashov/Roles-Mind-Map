import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CommentsModal } from "../CommentsModal.js";
import type { CommentItem } from "../../types.js";
import { __resetBackStack } from "../../lib/backStack.js";

test("empty state shows the add-comment button", () => {
  render(<CommentsModal open value={[]} onCancel={() => {}} onSave={() => {}} />);
  expect(screen.getByRole("button", { name: /добавить комментарий/i })).toBeInTheDocument();
});

test("adds a comment via the editor and returns it on save", async () => {
  const onSave = vi.fn();
  render(<CommentsModal open value={[]} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: /добавить комментарий/i }));
  await userEvent.type(screen.getByRole("textbox"), "born in Moscow");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // editor save
  await waitForElementToBeRemoved(() => screen.queryByRole("textbox"));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // modal save
  expect(onSave).toHaveBeenCalledWith([{ id: null, text: "born in Moscow" }]);
});

test("lists a comment titled with its index and 15-char preview", () => {
  const value: CommentItem[] = [{ id: "c1", text: "a very long comment body here" }];
  render(<CommentsModal open value={value} onCancel={() => {}} onSave={() => {}} />);
  expect(screen.getByText("1. a very long com…")).toBeInTheDocument();
});

test("deletes a comment via its trash button", async () => {
  const onSave = vi.fn();
  const value: CommentItem[] = [{ id: "c1", text: "remove me" }];
  render(<CommentsModal open value={value} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: /удалить комментарий 1/i }));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([]);
});

test("edits an existing comment, preserving its id", async () => {
  const onSave = vi.fn();
  const value: CommentItem[] = [{ id: "c1", text: "old text" }];
  render(<CommentsModal open value={value} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByText("1. old text"));
  const box = screen.getByRole("textbox");
  await userEvent.clear(box);
  await userEvent.type(box, "new text");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // editor save
  await waitForElementToBeRemoved(() => screen.queryByRole("textbox"));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i })); // modal save
  expect(onSave).toHaveBeenCalledWith([{ id: "c1", text: "new text" }]);
});

test("Back button cancels the comments modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<CommentsModal open value={[]} onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
