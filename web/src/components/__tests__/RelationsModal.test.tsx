import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RelationsModal } from "../RelationsModal.js";
import type { Character } from "../../types.js";
import { __resetBackStack } from "../../lib/backStack.js";

// Wheel/shade are third-party canvas-ish widgets; mock them so the modal state is
// exercised via the HEX input deterministically.
vi.mock("@uiw/react-color", () => ({
  Wheel: () => null,
  ShadeSlider: () => null,
  hexToHsva: () => ({ h: 0, s: 0, v: 0, a: 1 }),
  hsvaToHex: () => "#000000",
}));

const others: Character[] = [
  { id: "p", bookId: "b", gender: "male", firstName: "Петя", lastName: "П" },
  { id: "z", bookId: "b", gender: "female", firstName: "Жанна", lastName: "Ж" },
];

test("adds a connection via the menu and returns it on save", async () => {
  const onSave = vi.fn();
  render(<RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={onSave} />);
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /^существующий$/i }));
  await waitForElementToBeRemoved(() => screen.queryByText(/связать с существующим/i));
  await userEvent.click(screen.getByRole("menuitem", { name: /жанна/i }));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ otherId: "z", role: "", color: null }]);
});

test("hides already-connected characters from the add menu", async () => {
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "", color: null }]}
      onCancel={() => {}} onSave={() => {}} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /^существующий$/i }));
  expect(screen.queryByRole("menuitem", { name: /петя/i })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /жанна/i })).toBeInTheDocument();
});

test("edits the role of a connection", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "", color: null }]}
      onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.type(screen.getByLabelText(/роль/i), "друзья");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ otherId: "p", role: "друзья", color: null }]);
});

test("picks a colour for a connection via the hex input", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "друзья", color: null }]}
      onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /цвет линии для Петя П/i }));
  const hex = screen.getByLabelText(/hex/i);
  await userEvent.clear(hex);
  await userEvent.type(hex, "#112233");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ otherId: "p", role: "друзья", color: "#112233" }]);
});

test("removes a connection", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "друзья", color: null }]}
      onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /удалить связь с Петя П/i }));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([]);
});

test("the role field is marked optional", () => {
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "", color: null }]}
      onCancel={() => {}} onSave={() => {}} />,
  );
  expect(screen.getByText(/необязательно/i)).toBeInTheDocument();
});

test("Back button cancels the relations modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(<RelationsModal open others={others} value={[]} onCancel={onCancel} onSave={() => {}} />);
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("«Новый персонаж» returns the current staged rows", async () => {
  const onCreateNew = vi.fn();
  render(
    <RelationsModal open others={others} value={[{ otherId: "p", role: "друзья", color: null }]}
      onCancel={() => {}} onSave={() => {}} onCreateNew={onCreateNew} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /новый персонаж/i }));
  expect(onCreateNew).toHaveBeenCalledWith([{ otherId: "p", role: "друзья", color: null }]);
});

test("the add button shows and «Существующий» is disabled when everyone is already connected", async () => {
  render(
    <RelationsModal open others={others}
      value={[{ otherId: "p", role: "", color: null }, { otherId: "z", role: "", color: null }]}
      onCancel={() => {}} onSave={() => {}} onCreateNew={() => {}} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  expect(screen.getByRole("button", { name: /^существующий$/i })).toBeDisabled();
});
