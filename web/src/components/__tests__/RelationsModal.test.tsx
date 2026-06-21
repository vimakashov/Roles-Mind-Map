import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RelationsModal } from "../RelationsModal.js";
import type { Character } from "../../types.js";
import { __resetBackStack } from "../../lib/backStack.js";

// The wheel/shade widgets are third-party canvas-ish components; mock them so the
// test exercises our modal state via the HEX input deterministically.
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

test("adds an entry and returns it on save", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.type(screen.getByLabelText(/роль/i), "сын");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ role: "сын", targets: [] }]);
});

test("picks a colour for a target via the hex input", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal
      open
      others={others}
      value={[{ role: "друг", targets: [{ id: "p", color: null }] }]}
      onCancel={() => {}}
      onSave={onSave}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /цвет линии для Петя П/i }));
  const hex = screen.getByLabelText(/hex/i);
  await userEvent.clear(hex);
  await userEvent.type(hex, "#112233");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([
    { role: "друг", targets: [{ id: "p", color: "#112233" }] },
  ]);
});

test("saves an entry with an empty role", async () => {
  const onSave = vi.fn();
  render(
    <RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={onSave} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  // Leave the role blank, just save.
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSave).toHaveBeenCalledWith([{ role: "", targets: [] }]);
});

test("the role field is marked optional", async () => {
  render(<RelationsModal open others={others} value={[]} onCancel={() => {}} onSave={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  expect(screen.getByText(/необязательно/i)).toBeInTheDocument();
});

test("Back button cancels the relations modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(
    <RelationsModal open others={others} value={[]} onCancel={onCancel} onSave={() => {}} />,
  );
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
