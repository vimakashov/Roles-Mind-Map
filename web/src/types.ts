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
  deceased?: boolean;
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

/** One undirected connection from a character's perspective:
 *  the other endpoint, a symmetric label, and the line colour (null = default). */
export interface RelationConnection {
  otherId: string;
  role: string;
  color: string | null;
}
