import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";

interface RecordAuditInput {
  userId?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  amount?: number;
  status?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Journalise une operation sensible : date/heure (createdAt), identifiant de l'entite,
 * acteur, montant et statut (cahier, section 7). A appeler depuis les services metier.
 * Accepte un client de transaction pour que la trace soit atomique avec l'operation.
 */
export async function recordAudit(
  input: RecordAuditInput,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      amount: input.amount,
      status: input.status,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
    },
  });
}
