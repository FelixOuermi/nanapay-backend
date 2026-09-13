import { createApp } from "./app";
import { env } from "@config/env";
import { logger } from "@config/logger";
import { prisma } from "@config/prisma";
import { cleanupExpiredRecords } from "@services/maintenance/cleanupService";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`NanaPay backend demarre sur ${env.APP_URL} (port ${env.PORT})`);
});

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 heures

cleanupExpiredRecords().catch((error) => logger.error("Echec du nettoyage initial", { error }));
const cleanupInterval = setInterval(() => {
  cleanupExpiredRecords().catch((error) => logger.error("Echec du nettoyage periodique", { error }));
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref(); // ne doit pas empecher le process de s'arreter proprement

async function shutdown(signal: string) {
  logger.info(`Signal ${signal} recu, arret en cours...`);
  clearInterval(cleanupInterval);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
