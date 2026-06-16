import { execSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { ensureDefaultUser } from "./defaultUser.js";

async function main() {
  // Apply schema to the (possibly empty) database on the volume.
  execSync("prisma migrate deploy || prisma db push --skip-generate", { stdio: "inherit" });
  await ensureDefaultUser();

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
