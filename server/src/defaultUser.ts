import { prisma } from "./db.js";

export const DEFAULT_USER_ID = "default-user";

/** Ensures the single local user exists and returns its id. */
export async function ensureDefaultUser(): Promise<string> {
  await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: { id: DEFAULT_USER_ID, name: "Local user" },
  });
  return DEFAULT_USER_ID;
}
