import { prisma } from "@config/prisma";
import { logger } from "@config/logger";

const REVOKED_TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

/**
 * Purge les lignes techniques qui n'ont plus d'utilite : cles d'idempotence expirees
 * et refresh tokens revoques/expires depuis longtemps. Rien dans le cahier des taches
 * n'impose ce nettoyage, mais sans lui idempotency_keys et refresh_tokens grossissent
 * indefiniment (une ligne par requete/session).
 */
export async function cleanupExpiredRecords(): Promise<void> {
  const now = new Date();

  const [idempotencyKeys, refreshTokens] = await Promise.all([
    prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: new Date(now.getTime() - REVOKED_TOKEN_RETENTION_MS) } },
        ],
      },
    }),
  ]);

  if (idempotencyKeys.count > 0 || refreshTokens.count > 0) {
    logger.info("Nettoyage des enregistrements techniques expires", {
      idempotencyKeysDeleted: idempotencyKeys.count,
      refreshTokensDeleted: refreshTokens.count,
    });
  }
}
