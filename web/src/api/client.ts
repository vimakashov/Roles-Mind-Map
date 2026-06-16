import type { Book, BookGraph, Character, RelationEntry } from "../types.js";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
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
