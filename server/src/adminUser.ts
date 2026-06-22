import { prisma } from "./db.js";
import { hashPassword } from "./auth.js";

export const ADMIN_NICKNAME = "synthmadness";
export const ADMIN_PASSWORD = "6629";
export const LEGACY_USER_ID = "default-user";
/** Back-compat alias: the seeded admin keeps the legacy row id, so service-direct
 *  tests that create books with a fixed owner id keep resolving to a real user. */
export const DEFAULT_USER_ID = LEGACY_USER_ID;

/** Ensure the seeded admin account exists, owning all pre-existing data.
 *  Idempotent: never resets an already-credentialed admin's password.
 *  (No orphan-book reassignment needed: FK `onDelete: Cascade` + Prisma's
 *  enforced foreign keys make books with a missing owner impossible.) */
export async function ensureAdminUser(): Promise<void> {
  const legacy = await prisma.user.findUnique({ where: { id: LEGACY_USER_ID } });

  if (legacy) {
    // Pre-auth local user → upgrade in place so its books stay attached.
    if (!legacy.passwordHash) {
      await prisma.user.update({
        where: { id: LEGACY_USER_ID },
        data: { name: ADMIN_NICKNAME, passwordHash: hashPassword(ADMIN_PASSWORD) },
      });
    }
    return;
  }

  const admin = await prisma.user.findFirst({ where: { name: ADMIN_NICKNAME } });
  if (!admin) {
    await prisma.user.create({
      data: { id: LEGACY_USER_ID, name: ADMIN_NICKNAME, passwordHash: hashPassword(ADMIN_PASSWORD) },
    });
  }
}
