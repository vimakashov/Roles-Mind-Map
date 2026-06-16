import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi, beforeEach } from "vitest";
import { api } from "../../api/client.js";
import { BooksScreen } from "../BooksScreen.js";

vi.mock("../../api/client.js", () => ({
  api: { listBooks: vi.fn(), createBook: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

test("shows centered add button when empty", async () => {
  (api.listBooks as any).mockResolvedValue([]);
  render(<MemoryRouter><BooksScreen /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: /добавить книгу/i })).toBeInTheDocument();
});

test("adds a book through the modal", async () => {
  (api.listBooks as any).mockResolvedValue([]);
  (api.createBook as any).mockResolvedValue({ id: "1", title: "Война и мир", sortOrder: 0 });
  render(<MemoryRouter><BooksScreen /></MemoryRouter>);

  await userEvent.click(await screen.findByRole("button", { name: /добавить книгу/i }));
  await userEvent.type(screen.getByLabelText(/название/i), "Война и мир");
  await userEvent.click(screen.getByRole("button", { name: /^добавить$/i }));

  await waitFor(() => expect(api.createBook).toHaveBeenCalledWith("Война и мир"));
  expect(await screen.findByText(/Война и мир/)).toBeInTheDocument();
});
