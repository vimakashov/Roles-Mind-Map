import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";
import { RelationEditModal } from "../RelationEditModal.js";
import type { Relationship } from "../../types.js";
import { __resetBackStack } from "../../lib/backStack.js";

vi.mock("../../api/client.js", () => ({
  api: {
    updateRelation: vi.fn().mockResolvedValue({}),
    deleteRelation: vi.fn().mockResolvedValue(undefined),
  },
}));
import { api } from "../../api/client.js";

const edge: Relationship = { id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null };

beforeEach(() => { vi.clearAllMocks(); __resetBackStack(); });

test("shows both endpoint names and the current role", () => {
  render(<RelationEditModal open relationship={edge} sourceName="Вася Петров" targetName="Маша Иванова" onCancel={() => {}} onChanged={() => {}} />);
  expect(screen.getByText("Вася Петров — Маша Иванова")).toBeInTheDocument();
  expect(screen.getByLabelText(/роль/i)).toHaveValue("друзья");
});

test("edits the role and saves via updateRelation, then calls onChanged", async () => {
  const onChanged = vi.fn();
  render(<RelationEditModal open relationship={edge} sourceName="A" targetName="B" onCancel={() => {}} onChanged={onChanged} />);
  const field = screen.getByLabelText(/роль/i);
  await userEvent.clear(field);
  await userEvent.type(field, "враги");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(api.updateRelation).toHaveBeenCalledWith("e1", { role: "враги", color: null });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("trash opens a confirm dialog; confirming calls deleteRelation and onChanged", async () => {
  const onChanged = vi.fn();
  render(<RelationEditModal open relationship={edge} sourceName="A" targetName="B" onCancel={() => {}} onChanged={onChanged} />);
  await userEvent.click(screen.getByRole("button", { name: /удалить связь/i }));
  expect(await screen.findByText("Удалить связь?")).toBeInTheDocument();
  const confirms = screen.getAllByRole("button", { name: /^удалить$/i });
  await userEvent.click(confirms[confirms.length - 1]);
  expect(api.deleteRelation).toHaveBeenCalledWith("e1");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("Back button cancels the modal", async () => {
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<RelationEditModal open relationship={edge} sourceName="A" targetName="B" onCancel={onCancel} onChanged={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
