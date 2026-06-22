import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { ensureAdminUser } from "./adminUser.js";
import { normalizeRelationships } from "./services/normalize.js";

async function main() {
  // Apply the schema to the (possibly empty) database on the volume.
  // This project has no migrations dir; `prisma db push` creates the tables
  // on first boot and is a no-op ("already in sync") on later restarts.
  // (`migrate deploy` would exit 0 with no migrations and never create tables.)
  // Collapse legacy duplicate pairs + canonicalise BEFORE the schema push, so the
  // new @@unique([sourceId, targetId]) index can be created on existing volumes.
  await normalizeRelationships();
  // `--accept-data-loss` is required because Prisma's data-loss guard fires
  // unconditionally when ADDING a unique constraint (it can't tell the data is
  // already deduped). It is safe here: normalizeRelationships() ran first, so no
  // Relationship rows are actually lost — the constraint applies to clean data.
  execSync("prisma db push --skip-generate --accept-data-loss", { stdio: "inherit" });
  await ensureAdminUser();

  const app = buildApp();

  const webDist = path.resolve(process.cwd(), "public");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Roles Mind Map server listening on :${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
