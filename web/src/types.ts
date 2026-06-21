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
  lastName?: string | null;
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
  color?: string | null;
}

export interface BookGraph {
  title?: string;
  nodes: Character[];
  edges: Relationship[];
}

/** A relation target and the colour of its line (null = default). */
export interface RelationTarget {
  id: string;
  color: string | null;
}

/** UI-level grouping: one role with its selected targets. */
export interface RelationEntry {
  role: string;
  targets: RelationTarget[];
}
