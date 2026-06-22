import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, test, vi, beforeEach } from "vitest";
import { __resetBackStack } from "../../lib/backStack.js";
import { api } from "../../api/client.js";
import { ShareScreen } from "../ShareScreen.js";
import type { BookGraph } from "../../types.js";

// Cytoscape canvas is unrenderable in jsdom; expose a tap button per node.
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
    getSharedGraph: vi.fn(),
    sharedAvatarUrl: (bookId: string, id: string, v: string) =>
      `/api/share/${bookId}/characters/${id}/avatar?v=${v}`,
    avatarUrl: (id: string, v: string) => `/api/characters/${id}/avatar?v=${v}`,
  },
}));

beforeEach(() => { vi.clearAllMocks(); __resetBackStack(); });

const graph: BookGraph = {
  title: "Война и мир",
  nodes: [{ id: "c1", bookId: "b1", gender: "male", firstName: "Вася", lastName: "Петров", age: 30 }],
  edges: [],
};

function renderShare() {
  return render(
    <MemoryRouter initialEntries={["/share/b1"]}>
      <Routes>
        <Route path="/share/:bookId" element={<ShareScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("renders the read-only canvas with no edit affordances and opens the read-only card", async () => {
  (api.getSharedGraph as any).mockResolvedValue(graph);
  renderShare();

  expect(await screen.findByText("Война и мир")).toBeInTheDocument();
  // No add FAB and no top-bar action icons.
  expect(screen.queryByRole("button", { name: /добавить персонажа/i })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /переименовать книгу|удалить книгу|назад|поделиться/i }),
  ).not.toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "tap-c1" }));
  expect(await screen.findByText("Вася Петров")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("shows an invalid-link message when the graph fetch fails", async () => {
  (api.getSharedGraph as any).mockRejectedValue(new Error("404"));
  renderShare();
  expect(await screen.findByText(/ссылка недействительна/i)).toBeInTheDocument();
});
