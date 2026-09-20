import { Prisma } from "@prisma/client";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { addMonths, daysBetween } from "@common/utils/date";
import { PageParams, toSkipTake } from "@common/utils/response";
import { recordAudit } from "@services/audit/auditService";
import { notifyAdmins, notifyUser } from "@services/notification/notificationService";
import { canExtendSavings, computeSavingsPenalty, getSavingsTerms } from "@services/financial/financialService";
import { getFinancialParams } from "@services/financial/settingsService";
import { cancelOrderAndRestock, getOwnOrderOrThrow } from "@modules/orders/order.service";
import { markOrderFinancedAndReady } from "@modules/orders/orderWorkflow";

/** Vue API d'une epargne : progression et echeance calculees cote serveur. */
function present<T extends { targetAmount: number; savedAmount: number; dueDate: Date | null }>(savings: T) {
  return {
    ...savings,
    remainingAmount: Math.max(0, savings.targetAmount - savings.savedAmount),
    progressPercent:
      savings.targetAmount > 0 ? Math.min(100, Math.floor((savings.savedAmount / savings.targetAmount) * 100)) : 0,
    daysRemaining: savings.dueDate ? daysBetween(new Date(), savings.dueDate) : null,
  };
}

async function getOwnSavingsOrThrow(clientId: string, savingsId: string) {
  const savings = await prisma.savings.findUnique({ where: { id: savingsId }, include: { order: true } });
  if (!savings || savings.order.clientId !== clientId) {
    throw AppError.notFound("Epargne introuvable");
  }
  return savings;
}

/**
 * POST /orders/:id/savings : ouvre le plan d'epargne. La date de depart n'est PAS fixee
 * ici mais au premier versement effectivement recu et valide (cahier, section 6).
 */
export async function createSavings(clientId: string, orderId: string, requestedMonths?: number) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.cancelledAt) {
    throw AppError.conflict("Cette commande est annulee");
  }
  if (order.financingMode !== "SAVINGS" || order.status !== "FINANCEMENT_EN_COURS") {
    throw AppError.conflict("Choisissez d'abord le financement par Epargne (POST /orders/:id/select-financing)");
  }
  if (order.savings) {
    throw AppError.conflict("Un plan d'epargne existe deja pour cette commande");
  }

  const params = await getFinancialParams();
  const terms = getSavingsTerms(order.amount, params);
  const durationMonths = requestedMonths ?? terms.maxDurationMonths;

  if (durationMonths > terms.maxDurationMonths) {
    throw AppError.badRequest(`Duree maximale : ${terms.maxDurationMonths} mois pour ce montant`);
  }

  const savings = await prisma.savings.create({
    data: {
      orderId,
      targetAmount: order.amount,
      minInstallment: terms.minInstallment,
      durationMonths,
    },
  });

  await recordAudit({
    actorRole: "CLIENT",
    action: "SAVINGS_CREATED",
    entityType: "savings",
    entityId: savings.id,
    amount: savings.targetAmount,
    status: savings.status,
    metadata: { orderId, durationMonths },
  });

  return {
    ...present(savings),
    // Reference a fournir lors du versement Mobile Money : le webhook rattache le paiement a la commande.
    paymentReference: order.id,
  };
}

export async function getSavings(clientId: string, savingsId: string) {
  await getOwnSavingsOrThrow(clientId, savingsId);
  await evaluateSavingsDeadline(savingsId);
  return present(await prisma.savings.findUniqueOrThrow({ where: { id: savingsId } }));
}

export async function getSavingsHistory(clientId: string, savingsId: string, page: PageParams) {
  await getOwnSavingsOrThrow(clientId, savingsId);
  const where = { savingsId };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      select: { id: true, kind: true, amount: true, currency: true, status: true, provider: true, providerTransactionId: true, createdAt: true, confirmedAt: true },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(page),
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, total };
}

/** POST /savings/:id/extension : prolongation (2 mois maximum au total), avant l'echeance. */
export async function extendSavings(clientId: string, savingsId: string, months: number) {
  const savings = await getOwnSavingsOrThrow(clientId, savingsId);
  await evaluateSavingsDeadline(savingsId);
  const current = await prisma.savings.findUniqueOrThrow({ where: { id: savingsId } });

  if (current.status !== "EN_COURS" && current.status !== "PROLONGATION") {
    throw AppError.conflict(`Prolongation impossible (statut : ${current.status})`);
  }
  if (!current.dueDate) {
    throw AppError.conflict("L'epargne demarre au premier versement : aucune echeance a prolonger pour l'instant");
  }

  const params = await getFinancialParams();
  if (!canExtendSavings(current.extensionMonths, months, params)) {
    throw AppError.badRequest(
      `Prolongation refusee : maximum ${params.savingsExtensionMaxMonths} mois au total (deja ${current.extensionMonths})`
    );
  }

  const updated = await prisma.savings.update({
    where: { id: savingsId },
    data: {
      extensionMonths: { increment: months },
      dueDate: addMonths(current.dueDate, months),
      status: "PROLONGATION",
    },
  });

  await recordAudit({
    userId: undefined,
    actorRole: "CLIENT",
    action: "SAVINGS_EXTENDED",
    entityType: "savings",
    entityId: savingsId,
    amount: current.savedAmount,
    status: "PROLONGATION",
    metadata: { months, orderId: savings.orderId },
  });

  return present(updated);
}

/**
 * Applique un versement valide (appele par le traitement des webhooks, dans SA transaction).
 * Premier versement : fixe la date de depart. 100 % atteint : ATTEINTE -> commande prete + QR.
 */
export async function applySavingsDeposit(
  tx: Prisma.TransactionClient,
  savingsId: string,
  amount: number,
  paymentAt: Date
) {
  const params = await getFinancialParams();
  const savings = await tx.savings.findUniqueOrThrow({ where: { id: savingsId }, include: { order: true } });

  const isFirstDeposit = savings.startedAt === null;
  const startedAt = savings.startedAt ?? paymentAt;
  const dueDate = isFirstDeposit
    ? addMonths(startedAt, savings.durationMonths + savings.extensionMonths)
    : savings.dueDate;

  const savedAmount = savings.savedAmount + amount;
  const reached = savedAmount >= savings.targetAmount;

  const updated = await tx.savings.update({
    where: { id: savingsId },
    data: { savedAmount, startedAt, dueDate, status: reached ? "ATTEINTE" : savings.status },
  });

  if (reached) {
    await markOrderFinancedAndReady(tx, savings.orderId, params.qrTtlHours);
  }

  return { savings: updated, reached, isFirstDeposit };
}

/**
 * Echec definitif : duree initiale + prolongation depassees sans atteindre l'objectif.
 * Penalite (15 %), remboursement du reste (85 %) a executer, commande annulee et stock
 * restitue. Idempotent : le passage a ECHOUEE est conditionnel au statut courant.
 * Retourne true si un changement a ete effectue.
 */
export async function evaluateSavingsDeadline(savingsId: string): Promise<boolean> {
  const savings = await prisma.savings.findUnique({ where: { id: savingsId }, include: { order: { include: { client: true } } } });

  if (!savings || !savings.dueDate) return false;
  if (savings.status !== "EN_COURS" && savings.status !== "PROLONGATION") return false;
  if (new Date() <= savings.dueDate) return false;

  const params = await getFinancialParams();
  const { penaltyAmount, refundAmount } = computeSavingsPenalty(savings.savedAmount, params);

  const changed = await prisma.$transaction(async (tx) => {
    const flipped = await tx.savings.updateMany({
      where: { id: savingsId, status: { in: ["EN_COURS", "PROLONGATION"] } },
      data: { status: "ECHOUEE", penaltyAmount, refundAmount },
    });
    if (flipped.count === 0) return false;

    await cancelOrderAndRestock(tx, savings.orderId, "Echec de l'epargne : echeance depassee");
    await recordAudit(
      {
        actorRole: "SYSTEM",
        action: "SAVINGS_FAILED",
        entityType: "savings",
        entityId: savingsId,
        amount: savings.savedAmount,
        status: "ECHOUEE",
        metadata: { penaltyAmount, refundAmount, orderId: savings.orderId },
      },
      tx
    );
    return true;
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  if (changed) {
    await notifyUser(
      savings.order.client.userId,
      "Epargne echouee",
      `Le delai de votre epargne est depasse. Penalite de ${penaltyAmount} FCFA, remboursement de ${refundAmount} FCFA en cours.`,
      { savingsId, orderId: savings.orderId }
    );
    await notifyAdmins("Remboursement d'epargne a executer", `Rembourser ${refundAmount} FCFA (commande ${savings.order.orderNumber}).`, {
      savingsId,
      refundAmount,
    });
  }
  return changed;
}

/** Job periodique : traite toutes les epargnes dont l'echeance est depassee. */
export async function sweepOverdueSavings(): Promise<number> {
  const overdue = await prisma.savings.findMany({
    where: { status: { in: ["EN_COURS", "PROLONGATION"] }, dueDate: { lt: new Date() } },
    select: { id: true },
    take: 500,
  });

  let processed = 0;
  for (const { id } of overdue) {
    if (await evaluateSavingsDeadline(id)) processed += 1;
  }
  return processed;
}

/** Admin : le remboursement (85 %) a ete verse au client -> REMBOURSEE, avec trace de paiement. */
export async function markSavingsRefunded(savingsId: string, adminUserId: string, reference?: string) {
  const savings = await prisma.savings.findUnique({ where: { id: savingsId }, include: { order: { include: { client: true } } } });
  if (!savings) {
    throw AppError.notFound("Epargne introuvable");
  }
  if (savings.status !== "ECHOUEE") {
    throw AppError.conflict(`Remboursement impossible (statut : ${savings.status})`);
  }

  await prisma.$transaction(async (tx) => {
    const flipped = await tx.savings.updateMany({ where: { id: savingsId, status: "ECHOUEE" }, data: { status: "REMBOURSEE" } });
    if (flipped.count === 0) {
      throw AppError.conflict("Remboursement deja traite");
    }
    await tx.payment.create({
      data: {
        orderId: savings.orderId,
        savingsId,
        kind: "SAVINGS_REFUND",
        amount: savings.refundAmount,
        status: "CONFIRME",
        confirmedAt: new Date(),
        providerTransactionId: reference,
      },
    });
    await recordAudit(
      {
        userId: adminUserId,
        actorRole: "ADMIN",
        action: "SAVINGS_REFUNDED",
        entityType: "savings",
        entityId: savingsId,
        amount: savings.refundAmount,
        status: "REMBOURSEE",
        metadata: { reference },
      },
      tx
    );
  });

  await notifyUser(savings.order.client.userId, "Epargne remboursee", `${savings.refundAmount} FCFA vous ont ete rembourses.`, { savingsId });
  return { id: savingsId, status: "REMBOURSEE" as const, refundAmount: savings.refundAmount };
}
