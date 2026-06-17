export type Gender = "male" | "female";

export interface Book {
  id: string;
  title: string;
  sortOrder: number;
}

export interface Character {
  id: string;
  bookId: string;
  gender: Gender;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  age?: number | null;
  posX?: number | null;
  posY?: number | null;
  avatarUpdatedAt?: string | null;
}

export interface Relationship {
  id: string;
  bookId: string;
  sourceId: string;
  targetId: string;
  role: string;
}

export interface BookGraph {
  nodes: Character[];
  edges: Relationship[];
}

/** UI-level grouping: one role with its selected targets. */
export interface RelationEntry {
  role: string;
  targetIds: string[];
}
