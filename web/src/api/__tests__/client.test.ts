import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../client.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => ({}),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function headersOf(call: unknown[]): Record<string, string> {
  return ((call[1] as RequestInit)?.headers ?? {}) as Record<string, string>;
}

test("bodyless requests do NOT set Content-Type (avoids Fastify empty-JSON 400)", async () => {
  await api.deleteCharacter("c1");
  await api.deleteBook("b1");
  await api.getGraph("b1");
  for (const call of fetchMock.mock.calls) {
    expect(headersOf(call)["Content-Type"]).toBeUndefined();
  }
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/characters/c1",
    expect.objectContaining({ method: "DELETE" }),
  );
});

test("requests with a body set Content-Type: application/json", async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
  await api.createBook("War");
  const headers = headersOf(fetchMock.mock.calls[0]);
  expect(headers["Content-Type"]).toBe("application/json");
});
