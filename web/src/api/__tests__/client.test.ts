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

test("avatarUrl includes the cache-busting version param", () => {
  expect(api.avatarUrl("c1", "2026-06-18T00:00:00.000Z")).toBe(
    "/api/characters/c1/avatar?v=2026-06-18T00%3A00%3A00.000Z",
  );
});

test("setAvatar PUTs a JSON body with base64 data and webp mime", async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" });
  await api.setAvatar("c1", blob);

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/characters/c1/avatar");
  expect(init.method).toBe("PUT");
  expect(headersOf([url, init])["Content-Type"]).toBe("application/json");
  const body = JSON.parse(init.body as string);
  expect(body.mimeType).toBe("image/webp");
  expect(body.data).toBe("AQIDBA==");
  expect(body.width).toBe(512);
  expect(body.height).toBe(512);
});

test("deleteAvatar issues a bodyless DELETE without Content-Type", async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
  await api.deleteAvatar("c1");
  const call = fetchMock.mock.calls[0];
  expect(call[0]).toBe("/api/characters/c1/avatar");
  expect((call[1] as RequestInit).method).toBe("DELETE");
  expect(headersOf(call)["Content-Type"]).toBeUndefined();
});
