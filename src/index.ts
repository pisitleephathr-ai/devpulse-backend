import "dotenv/config";
import app from "./app";
import { env } from "./lib/env";
import { prisma } from "./lib/prisma";

const server = app.listen(env.PORT, () => {
  console.log(`🚀 DevPulse API listening on http://localhost:${env.PORT}`);
});

// Graceful shutdown.
async function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down…`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
