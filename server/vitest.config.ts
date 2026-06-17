import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: [],
    // Force the Prisma client and the schema-push in test/helpers.ts onto the
    // same throwaway database. Set here (not via .env) so it wins over
    // server/.env, which PrismaClient would otherwise load (pointing tests at
    // dev.db). Without this, a fresh clone with no dev.db fails `npm test`.
    env: { DATABASE_URL: "file:./test.db" },
  },
});
