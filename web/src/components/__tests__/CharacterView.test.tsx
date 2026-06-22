import { render, screen } from "@testing-library/react";
import { expect, test, beforeEach } from "vitest";
import { __resetBackStack } from "../../lib/backStack.js";
import { CharacterView } from "../CharacterView.js";
import type { BookGraph } from "../../types.js";

beforeEach(() => __resetBackStack());

const graph: BookGraph = {
  title: "T",
  nodes: [
    {
      id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30,
      comments: [{ id: "k1", text: "Любит шахматы" }],
    },
    { id: "c2", bookId: "b1", gender: "female", firstName: "Маша", lastName: "Иванова" },
  ],
  edges: [{ id: "e1", bookId: "b1", sourceId: "c1", targetId: "c2", role: "друзья", color: null }],
};

test("renders character fields, relations, and comments read-only", () => {
  render(<CharacterView open character={graph.nodes[0]} graph={graph} onClose={() => {}} />);

  expect(screen.getByText("Вася Петров")).toBeInTheDocument();
  expect(screen.getByText("Мужчина")).toBeInTheDocument();
  expect(screen.getByText("Маша Иванова — друзья")).toBeInTheDocument();
  expect(screen.getByText("Любит шахматы")).toBeInTheDocument();

  // No editing affordances at all.
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /сохранить|удалить|добавить|изменить/i })).not.toBeInTheDocument();
});

test("shows empty states when there are no relations or comments", () => {
  render(<CharacterView open character={graph.nodes[1]} graph={graph} onClose={() => {}} />);
  expect(screen.getByText(/нет комментариев/i)).toBeInTheDocument();
  // c2 has one relation (to c1), so relations are not empty here:
  expect(screen.getByText("Вася Петров — друзья")).toBeInTheDocument();
});
