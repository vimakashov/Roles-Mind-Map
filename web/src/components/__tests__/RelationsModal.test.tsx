import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { RelationsModal } from "../RelationsModal.js";
import type { Character } from "../../types.js";

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
  expect(onSave).toHaveBeenCalledWith([{ role: "сын", targetIds: [] }]);
});
