import type { AuthUser, Book, BookGraph, Character, CommentItem, Relationship, RelationConnection } from "../types.js";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body. Setting it on
  // a bodyless request (GET/DELETE) makes Fastify reject the empty body with
  // 400 FST_ERR_CTP_EMPTY_JSON_BODY (notably through proxies that drop
  // Content-Length), which previously broke deletes.
  const headers = init?.body != null
    ? { "Content-Type": "application/json", ...init?.headers }
    : init?.headers;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const AVATAR_SIZE = 512;

async function blobToBase64(blob: Blob): Promise<string> {
  // blob.arrayBuffer() is unavailable in jsdom (test env); FileReader is the portable workaround.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // dataUrl is "data:<mime>;base64,<b64>" — strip the prefix
      resolve(dataUrl.split(",")[1]);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export interface CharacterInput {
  gender: "male" | "female";
  firstName: string;
  lastName?: string | null;
  middleName?: string | null;
  age?: number | null;
  deceased: boolean;
  relations: RelationConnection[];
  comments: CommentItem[];
}

export const api = {
  register: (nickname: string, password: string) =>
    req<AuthUser>("/api/auth/register", { method: "POST", body: JSON.stringify({ nickname, password }) }),
  login: (nickname: string, password: string) =>
    req<AuthUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ nickname, password }) }),
  me: () => req<AuthUser>("/api/auth/me"),
  listBooks: () => req<Book[]>("/api/books"),
  createBook: (title: string) =>
    req<Book>("/api/books", { method: "POST", body: JSON.stringify({ title }) }),
  deleteBook: (id: string) =>
    req<void>(`/api/books/${id}`, { method: "DELETE" }),
  updateBook: (id: string, title: string) =>
    req<Book>(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  getGraph: (bookId: string) => req<BookGraph>(`/api/books/${bookId}/graph`),
  getSharedGraph: (bookId: string) => req<BookGraph>(`/api/share/${bookId}/graph`),
  createCharacter: (bookId: string, input: CharacterInput) =>
    req<Character>("/api/characters", {
      method: "POST",
      body: JSON.stringify({ bookId, ...input }),
    }),
  updateCharacter: (id: string, input: CharacterInput) =>
    req<Character>(`/api/characters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  savePosition: (id: string, posX: number, posY: number) =>
    req<Character>(`/api/characters/${id}/pos`, {
      method: "PATCH",
      body: JSON.stringify({ posX, posY }),
    }),
  deleteCharacter: (id: string) =>
    req<void>(`/api/characters/${id}`, { method: "DELETE" }),
  updateRelation: (id: string, input: { role: string; color: string | null }) =>
    req<Relationship>(`/api/relationships/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteRelation: (id: string) =>
    req<void>(`/api/relationships/${id}`, { method: "DELETE" }),
  avatarUrl: (id: string, version: string) =>
    `/api/characters/${id}/avatar?v=${encodeURIComponent(version)}`,
  sharedAvatarUrl: (bookId: string, id: string, version: string) =>
    `/api/share/${bookId}/characters/${id}/avatar?v=${encodeURIComponent(version)}`,
  // Callers pass a baked 512x512 WebP blob; the server enforces image/webp (z.literal) and the 512 dims.
  setAvatar: async (id: string, blob: Blob) => {
    const data = await blobToBase64(blob);
    return req<{ ok: true }>(`/api/characters/${id}/avatar`, {
      method: "PUT",
      body: JSON.stringify({ data, mimeType: "image/webp", width: AVATAR_SIZE, height: AVATAR_SIZE }),
    });
  },
  deleteAvatar: (id: string) =>
    req<void>(`/api/characters/${id}/avatar`, { method: "DELETE" }),
};
