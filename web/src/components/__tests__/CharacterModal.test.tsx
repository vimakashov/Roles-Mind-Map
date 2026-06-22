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
      initial={{ gender: "female", firstName: "Аня", lastName: "С", deceased: false, relations: [], comments: [] }}
      onCancel={() => {}} onSubmit={() => {}} onDelete={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /^удалить$/i })).toBeInTheDocument();
});

test("avatar menu offers Add when the character has no custom avatar", async () => {
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", deceased: false, relations: [], comments: [] }}
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
      initial={{ gender: "male", firstName: "Б", lastName: "В", deceased: false, relations: [], comments: [] }}
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

test("toggling «Умер» submits deceased: true", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", deceased: false, relations: [], comments: [] }}
      onCancel={() => {}} onSubmit={onSubmit} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByLabelText(/умер/i));
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ deceased: true }),
    { kind: "none" },
  );
});

test("defaults deceased to false when the box is left unchecked", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{ gender: "male", firstName: "Б", lastName: "В", deceased: false, relations: [], comments: [] }}
      onCancel={() => {}} onSubmit={onSubmit} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ deceased: false }),
    { kind: "none" },
  );
});

test("«Новый персонаж» in relations validates A and calls onCreateLinked with staged input", async () => {
  const onCreateLinked = vi.fn();
  render(
    <CharacterModal
      open mode="edit"
      others={[{ id: "p", bookId: "b", gender: "male", firstName: "Петя", lastName: "П" }]}
      initial={{ gender: "female", firstName: "Аня", lastName: "С", deceased: false, relations: [], comments: [] }}
      onCancel={() => {}} onSubmit={() => {}} onCreateLinked={onCreateLinked} onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /связи/i }));
  await userEvent.click(screen.getByRole("button", { name: /добавить связь/i }));
  await userEvent.click(screen.getByRole("button", { name: /новый персонаж/i }));
  expect(onCreateLinked).toHaveBeenCalledWith(
    expect.objectContaining({ firstName: "Аня", relations: [] }),
    { kind: "none" },
  );
});

test("presetRelations seeds the staged relation count on a fresh create form", () => {
  render(
    <CharacterModal
      open mode="create" others={[{ id: "a1", bookId: "b", gender: "male", firstName: "Аня", lastName: "С" }]}
      presetRelations={[{ otherId: "a1", role: "", color: null }]}
      onCancel={() => {}} onSubmit={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /связи \(1\)/i })).toBeInTheDocument();
});

test("shows the staged comment count on the Комментарии button", () => {
  render(
    <CharacterModal
      open mode="edit" others={[]}
      initial={{
        gender: "male", firstName: "Vasya", lastName: "V", middleName: "", age: null,
        deceased: false, relations: [],
        comments: [{ id: "c1", text: "one" }, { id: "c2", text: "two" }],
      }}
      onCancel={() => {}} onSubmit={() => {}} onDelete={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /комментарии \(2\)/i })).toBeInTheDocument();
});
