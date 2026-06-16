import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CharacterModal } from "../CharacterModal.js";

test("blocks save until required fields are valid, then submits input", async () => {
  const onSubmit = vi.fn();
  render(
    <CharacterModal open mode="create" others={[]} onCancel={() => {}} onSubmit={onSubmit} onDelete={undefined} />,
  );
  // Submitting empty shows it did not call onSubmit.
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));
  expect(onSubmit).not.toHaveBeenCalled();

  await userEvent.click(screen.getByLabelText(/пол/i));
  await userEvent.click(screen.getByRole("option", { name: /мужчина/i }));
  await userEvent.type(screen.getByLabelText(/имя/i), "Вася");
  await userEvent.type(screen.getByLabelText(/фамилия/i), "Петров");
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ gender: "male", firstName: "Вася", lastName: "Петров", relations: [] }),
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
  expect(screen.getByRole("button", { name: /удалить/i })).toBeInTheDocument();
});
