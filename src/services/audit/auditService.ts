import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";

interface RecordAuditInput {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Journalise une action sensible (approbation, rejet, depot, virement, scan QR,
 * changement de statut de commande) conformement a la section 14 du cahier des taches.
 * A appeler depuis les services metier, jamais depuis les controleurs directement.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
    },
  });
}
