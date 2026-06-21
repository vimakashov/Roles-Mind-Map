import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CharacterModal } from "../CharacterModal.js";
import { __resetBackStack } from "../../lib/backStack.js";

vi.mock("../AvatarCropDialog.js", () => ({ AvatarCropDialog: () => null }));

test("blocks save until required fields are valid, then submits input with no avatar change", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal open mode="create" others={[]} onCancel={() => {}} onSubmit={onSubmit} onDelete={undefined} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));
  expect(onSubmit).not.toHaveBeenCalled();

  await userEvent.click(screen.getByLabelText(/пол/i));
  await userEvent.click(screen.getByRole("option", { name: /мужчина/i }));
  await userEvent.type(screen.getByLabelText(/имя/i), "Вася");
  await userEvent.type(screen.getByLabelText(/фамилия/i), "Петров");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$|^добавить$/i }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ gender: "male", firstName: "Вася", lastName: "Петров", relations: [] }),
    { kind: "none" },
  );
});

test("edit mode shows a delete button", () => {
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "female", firstName: "Аня", lastName: "С", relations: [] }}
      onCancel={() => {}} onSubmit={() => {}} onDelete={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /^удалить$/i })).toBeInTheDocument();
});

test("avatar menu offers Add when the character has no custom avatar", async () => {
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", relations: [] }}
      characterId="c1"
      onCancel={() => {}} onSubmit={() => {}} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByTestId("avatar-button"));
  expect(screen.getByRole("menuitem", { name: /добавить/i })).toBeInTheDocument();
});

test("avatar menu offers Change/Remove when a custom avatar exists, and Remove stages a removal", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", relations: [] }}
      characterId="c1" avatarUpdatedAt="2026-06-18T00:00:00.000Z"
      onCancel={() => {}} onSubmit={onSubmit} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByTestId("avatar-button"));
  expect(screen.getByRole("menuitem", { name: /изменить/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: /удалить/i }));

  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSubmit).toHaveBeenCalledWith(expect.any(Object), { kind: "remove" });
});

test("Back button cancels the character modal", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  const onCancel = vi.fn();
  render(
    <CharacterModal open mode="create" others={[]} onCancel={onCancel} onSubmit={() => {}} />,
  );
  await new Promise<void>((r) => queueMicrotask(() => r()));
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
