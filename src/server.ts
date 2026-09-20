import { createApp } from "./app";
import { env } from "@config/env";
import { logger } from "@config/logger";
import { prisma } from "@config/prisma";
import { cleanupExpiredRecords } from "@services/maintenance/cleanupService";
import { sweepOverdueSavings } from "@modules/savings/savings.service";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`NanaPay backend demarre sur ${env.APP_URL} (port ${env.PORT})`);
});

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 heures
const SAVINGS_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 heure

cleanupExpiredRecords().catch((error) => logger.error("Echec du nettoyage initial", { error }));
const cleanupInterval = setInterval(() => {
  cleanupExpiredRecords().catch((error) => logger.error("Echec du nettoyage periodique", { error }));
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref(); // ne doit pas empecher le process de s'arreter proprement

// Epargnes dont l'echeance (duree + prolongation) est depassee : echec, penalite, remboursement a executer.
const runSavingsSweep = () =>
  sweepOverdueSavings().catch((error) => logger.error("Echec du controle des echeances d'epargne", { error }));
runSavingsSweep();
const savingsSweepInterval = setInterval(runSavingsSweep, SAVINGS_SWEEP_INTERVAL_MS);
savingsSweepInterval.unref();

async function shutdown(signal: string) {
  logger.info(`Signal ${signal} recu, arret en cours...`);
  clearInterval(cleanupInterval);
  clearInterval(savingsSweepInterval);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
