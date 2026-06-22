import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SESSION_COOKIE = "rmm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 10; // ~10 years, in seconds

const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(plain, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Resolve the cookie-signing secret: env var, else a generated secret persisted
 *  next to the SQLite DB so it survives restarts (cookies stay valid). */
export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const dbFile = url.startsWith("file:") ? url.slice("file:".length) : "./dev.db";
  const secretPath = path.join(path.dirname(dbFile), "session-secret");

  if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();
  const generated = randomBytes(32).toString("hex");
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}
