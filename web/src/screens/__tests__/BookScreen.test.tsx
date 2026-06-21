import { render, screen, waitFor, act } from "@testing-library/react";
import { __resetBackStack } from "../../lib/backStack.js";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, test, vi, beforeEach } from "vitest";
import { api } from "../../api/client.js";
import { BookScreen } from "../BookScreen.js";
import type { BookGraph } from "../../types.js";

// Mock the cytoscape canvas (unrenderable in jsdom). Expose a button per node
// that fires onNodeTap so we can drive the real edit/delete wiring.
vi.mock("../../canvas/MindMap.js", () => ({
  MindMap: ({ graph, onNodeTap }: { graph: BookGraph; onNodeTap: (id: string) => void }) => (
    <div data-testid="mindmap">
      {graph.nodes.map((n) => (
        <button key={n.id} onClick={() => onNodeTap(n.id)}>{`tap-${n.id}`}</button>
      ))}
    </div>
  ),
}));

vi.mock("../../api/client.js", () => ({
  api: {
    getGraph: vi.fn(),
    createCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    deleteBook: vi.fn(),
    updateBook: vi.fn(),
    savePosition: vi.fn(),
    setAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
    avatarUrl: (id: string, v: string) => `/api/characters/${id}/avatar?v=${v}`,
  },
}));

beforeEach(() => vi.clearAllMocks());

const oneCharacter: BookGraph = {
  title: "Война и мир",
  nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30 }],
  edges: [],
};

function renderBookScreen() {
  return render(
    <MemoryRouter initialEntries={["/books/b1"]}>
      <Routes>
        <Route path="/books/:bookId" element={<BookScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("deletes a character through the edit modal and confirm dialog", async () => {
  (api.getGraph as any)
    .mockResolvedValueOnce(oneCharacter) // initial load
    .mockResolvedValueOnce({ nodes: [], edges: [] }); // after delete
  (api.deleteCharacter as any).mockResolvedValue(undefined);

  renderBookScreen();

  // Open the edit modal by "tapping" the node.
  await userEvent.click(await screen.findByRole("button", { name: "tap-c1" }));
  expect(await screen.findByText(/^Персонаж$/)).toBeInTheDocument();

  // Click "Удалить" in the modal actions, then confirm.
  await userEvent.click(screen.getByRole("button", { name: /^удалить$/i }));
  // Confirm dialog appears; click its "Удалить".
  const confirmButtons = await screen.findAllByRole("button", { name: /^удалить$/i });
  await userEvent.click(confirmButtons[confirmButtons.length - 1]);

  await waitFor(() => expect(api.deleteCharacter).toHaveBeenCalledWith("c1"));
  // Graph refetched and now empty.
  expect(await screen.findByText(/Персонажей пока нет/)).toBeInTheDocument();
});

test("deletes the book from the top bar and navigates home", async () => {
  (api.getGraph as any).mockResolvedValue(oneCharacter);
  (api.deleteBook as any).mockResolvedValue(undefined);

  render(
    <MemoryRouter initialEntries={["/books/b1"]}>
      <Routes>
        <Route path="/books/:bookId" element={<BookScreen />} />
        <Route path="/" element={<div>Список книг</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await userEvent.click(await screen.findByRole("button", { name: /удалить книгу/i }));
  const confirm = await screen.findByRole("button", { name: /^удалить$/i });
  await userEvent.click(confirm);

  await waitFor(() => expect(api.deleteBook).toHaveBeenCalledWith("b1"));
  expect(await screen.findByText(/Список книг/)).toBeInTheDocument();
});

test("removing the avatar in the edit modal calls deleteAvatar with the character id", async () => {
  (api.getGraph as any).mockResolvedValue({
    nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30, avatarUpdatedAt: "2026-06-18T00:00:00.000Z" }],
    edges: [],
  });
  (api.updateCharacter as any).mockResolvedValue({ id: "c1" });
  (api.deleteAvatar as any).mockResolvedValue(undefined);

  renderBookScreen();
  await userEvent.click(await screen.findByRole("button", { name: "tap-c1" }));

  // Open the avatar menu and choose "Удалить" (the avatar removal, not the character).
  await userEvent.click(await screen.findByTestId("avatar-button"));
  await userEvent.click(await screen.findByRole("menuitem", { name: /удалить/i }));

  // Save the modal.
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));

  await waitFor(() => expect(api.deleteAvatar).toHaveBeenCalledWith("c1"));
});

test("renames the book from the top bar pencil", async () => {
  (api.getGraph as any).mockResolvedValue(oneCharacter);
  (api.updateBook as any).mockResolvedValue({ id: "b1", title: "Анна Каренина", sortOrder: 0 });

  renderBookScreen();

  await userEvent.click(await screen.findByRole("button", { name: /переименовать книгу/i }));
  const field = await screen.findByLabelText(/название/i);
  expect(field).toHaveValue("Война и мир");
  await userEvent.clear(field);
  await userEvent.type(field, "Анна Каренина");
  await userEvent.click(screen.getByRole("button", { name: /^сохранить$/i }));

  await waitFor(() => expect(api.updateBook).toHaveBeenCalledWith("b1", "Анна Каренина"));
});

test("Back closes the rename dialog instead of navigating", async () => {
  __resetBackStack();
  vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  vi.spyOn(window.history, "go").mockImplementation(() => {});
  // renderBookScreen() is the existing helper in this file that mounts
  // BookScreen under MemoryRouter at /books/b1 with api mocked.
  renderBookScreen();
  await screen.findByText(/./); // wait for first render/graph load as existing tests do

  await userEvent.click(screen.getByRole("button", { name: /переименовать|изменить/i }));
  expect(await screen.findByText("Переименовать книгу")).toBeInTheDocument();
  await new Promise<void>((r) => queueMicrotask(() => r()));

  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() =>
    expect(screen.queryByText("Переименовать книгу")).not.toBeInTheDocument(),
  );
});
