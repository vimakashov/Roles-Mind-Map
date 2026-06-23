import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AuthGate } from "../AuthGate.js";
import { api } from "../api/client.js";

test("renders children when /me succeeds", async () => {
  vi.spyOn(api, "me").mockResolvedValue({ id: "u1", name: "tester" });
  render(<AuthGate><div>secret app</div></AuthGate>);
  expect(await screen.findByText("secret app")).toBeInTheDocument();
});

test("renders the auth screen when /me returns 401", async () => {
  vi.spyOn(api, "me").mockRejectedValue(new Error("GET /api/auth/me -> 401"));
  render(<AuthGate><div>secret app</div></AuthGate>);
  await waitFor(() => expect(screen.getByRole("button", { name: /^войти$/i })).toBeInTheDocument());
  expect(screen.queryByText("secret app")).not.toBeInTheDocument();
});
