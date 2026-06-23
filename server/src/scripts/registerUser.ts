import { pathToFileURL } from "node:url";
import { createUser, NicknameTakenError } from "../services/users.js";
import { prisma } from "../db.js";

export interface RegisterResult {
  code: number;
  out: string;
}

/** Create a user from env-provided credentials. Returns an exit code + message; never throws. */
export async function register(env: NodeJS.ProcessEnv): Promise<RegisterResult> {
  const username = env.username?.trim();
  const password = env.password;
  if (!username || !password) {
    return { code: 1, out: "usage: username=<name> password=<password> ./register_new.sh" };
  }
  try {
    const user = await createUser(username, password);
    return { code: 0, out: `created user ${user.name} (${user.id})` };
  } catch (e) {
    if (e instanceof NicknameTakenError) return { code: 2, out: `никнейм занят: ${username}` };
    return { code: 3, out: `недопустимые данные: ${(e as Error).message}` };
  }
}

// Run only when executed directly (`node dist/scripts/registerUser.js`), not on import (tests).
const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  register(process.env)
    .then(async ({ code, out }) => {
      (code === 0 ? console.log : console.error)(out);
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(99);
    });
}
