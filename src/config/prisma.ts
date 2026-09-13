import { PrismaClient } from "@prisma/client";
import { env } from "./env";

export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

/**
 * Options a passer en 2e argument de tout prisma.$transaction(async (tx) => {...}).
 * Le defaut Prisma (5s) peut etre trop court en production sur une base distante a
 * latence non negligeable (ex: Neon/serverless) pour des transactions qui enchainent
 * plusieurs requetes (verification de stock, creation de commande, etc.).
 */
export const INTERACTIVE_TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 };
