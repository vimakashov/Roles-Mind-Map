import type { Book, BookGraph, Character, RelationEntry } from "../types.js";

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

export interface CharacterInput {
  gender: "male" | "female";
  firstName: string;
  lastName: string;
  middleName?: string | null;
  age?: number | null;
  relations: RelationEntry[];
}

export const api = {
  listBooks: () => req<Book[]>("/api/books"),
  createBook: (title: string) =>
    req<Book>("/api/books", { method: "POST", body: JSON.stringify({ title }) }),
  deleteBook: (id: string) =>
    req<void>(`/api/books/${id}`, { method: "DELETE" }),
  getGraph: (bookId: string) => req<BookGraph>(`/api/books/${bookId}/graph`),
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
};
