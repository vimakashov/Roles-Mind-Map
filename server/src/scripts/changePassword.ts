import { pathToFileURL } from "node:url";
import { setPassword, UserNotFoundError } from "../services/users.js";
import { prisma } from "../db.js";

export interface ChangeResult {
  code: number;
  out: string;
}

/** Change an existing user's password from env-provided credentials. Returns an exit code + message; never throws. */
export async function changePassword(env: NodeJS.ProcessEnv): Promise<ChangeResult> {
  const username = env.username?.trim();
  const password = env.password;
  if (!username || !password) {
    return { code: 1, out: "usage: username=<name> password=<password> ./change_pwd.sh" };
  }
  try {
    const user = await setPassword(username, password);
    return { code: 0, out: `пароль изменён для ${user.name}` };
  } catch (e) {
    if (e instanceof UserNotFoundError) return { code: 2, out: "Пользователя с указанным username не существует" };
    return { code: 3, out: `недопустимые данные: ${(e as Error).message}` };
  }
}

// Run only when executed directly (`node dist/scripts/changePassword.js`), not on import (tests).
const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  changePassword(process.env)
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
