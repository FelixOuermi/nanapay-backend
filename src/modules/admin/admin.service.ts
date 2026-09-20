import { ClientStatus, MerchantStatus, Prisma } from "@prisma/client";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { PageParams, toSkipTake } from "@common/utils/response";
import { recordAudit } from "@services/audit/auditService";
import { notifyUser } from "@services/notification/notificationService";
import { getFinancialParams, updateFinancialParams, financialParamsPatchSchema } from "@services/financial/settingsService";
import { markSavingsRefunded } from "@modules/savings/savings.service";
import { assertTransition } from "@modules/orders/orderStateMachine";
import { z } from "zod";

async function paginate<T>(
  page: PageParams,
  find: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>
) {
  const [items, total] = await Promise.all([find(toSkipTake(page)), count()]);
  return { items, total };
}

// ------------------------------------------------------------------
// Tableau de bord
// ------------------------------------------------------------------

export async function getDashboard() {
  const [
    clients,
    merchantsByStatus,
    ordersByStatus,
    savingsByStatus,
    creditsByStatus,
    creditProfilesPending,
    pendingSettlements,
    confirmedPayments,
    pendingSettlementSum,
    rejectedWebhooks,
  ] = await Promise.all([
    prisma.client.count(),
    prisma.merchant.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.savings.groupBy({ by: ["status"], _count: { _all: true }, _sum: { savedAmount: true } }),
    prisma.credit.groupBy({ by: ["status"], _count: { _all: true }, _sum: { totalAmountToWire: true } }),
    prisma.creditProfile.count({ where: { status: "EN_ANALYSE" } }),
    prisma.merchantSettlement.count({ where: { status: "EN_ATTENTE" } }),
    prisma.payment.aggregate({ where: { status: "CONFIRME" }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.merchantSettlement.aggregate({ where: { status: "EN_ATTENTE" }, _sum: { netAmount: true } }),
    prisma.paymentEvent.count({ where: { result: "REJECTED" } }),
  ]);

  const tally = <K extends string>(rows: { status: K; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.map((row) => [row.status, row._count._all]));

  return {
    clients,
    merchants: tally(merchantsByStatus),
    orders: tally(ordersByStatus),
    savings: {
      byStatus: tally(savingsByStatus),
      totalSavedAmount: savingsByStatus.reduce((sum, row) => sum + (row._sum.savedAmount ?? 0), 0),
    },
    credits: {
      byStatus: tally(creditsByStatus),
      totalToWire: creditsByStatus.reduce((sum, row) => sum + (row._sum.totalAmountToWire ?? 0), 0),
    },
    creditProfilesPending,
    payments: { confirmedCount: confirmedPayments._count._all, confirmedAmount: confirmedPayments._sum.amount ?? 0 },
    settlements: { pendingCount: pendingSettlements, pendingAmount: pendingSettlementSum._sum.netAmount ?? 0 },
    rejectedWebhookEvents: rejectedWebhooks,
  };
}

// ------------------------------------------------------------------
// Comptes
// ------------------------------------------------------------------

export function listClients(page: PageParams, status?: ClientStatus) {
  const where: Prisma.ClientWhereInput = status ? { status } : {};
  return paginate(
    page,
    (args) =>
      prisma.client.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, email: true, isActive: true } },
          creditProfile: { select: { status: true } },
        },
        orderBy: { createdAt: "desc" },
        ...args,
      }),
    () => prisma.client.count({ where })
  );
}

export function listMerchants(page: PageParams, status?: MerchantStatus) {
  const where: Prisma.MerchantWhereInput = status ? { status } : {};
  return paginate(
    page,
    (args) =>
      prisma.merchant.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          ifuRccmNumber: true,
          defaultPayoutChannel: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, email: true, isActive: true } },
          store: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        ...args,
      }),
    () => prisma.merchant.count({ where })
  );
}

export async function setMerchantStatus(adminUserId: string, merchantId: string, status: "VALIDE" | "SUSPENDU", reason?: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    throw AppError.notFound("Commercant introuvable");
  }
  if (merchant.status === status) {
    throw AppError.conflict(`Le commercant est deja ${status}`);
  }

  const updated = await prisma.merchant.update({ where: { id: merchantId }, data: { status } });
  await recordAudit({
    userId: adminUserId,
    actorRole: "ADMIN",
    action: status === "VALIDE" ? "MERCHANT_VALIDATED" : "MERCHANT_SUSPENDED",
    entityType: "merchant",
    entityId: merchantId,
    status,
    metadata: { reason },
  });
  await notifyUser(
    merchant.userId,
    status === "VALIDE" ? "Compte commercant valide" : "Compte commercant suspendu",
    status === "VALIDE" ? "Votre compte est valide : vous pouvez ouvrir votre boutique." : `Votre compte a ete suspendu${reason ? ` : ${reason}` : "."}`
  );
  return updated;
}

export async function setClientStatus(adminUserId: string, clientId: string, status: ClientStatus, reason?: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw AppError.notFound("Client introuvable");
  }

  const updated = await prisma.client.update({ where: { id: clientId }, data: { status } });
  if (status === "SUSPENDU") {
    await prisma.refreshToken.updateMany({ where: { userId: client.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  await recordAudit({
    userId: adminUserId,
    actorRole: "ADMIN",
    action: status === "ACTIF" ? "CLIENT_REACTIVATED" : "CLIENT_SUSPENDED",
    entityType: "client",
    entityId: clientId,
    status,
    metadata: { reason },
  });
  return updated;
}

// ------------------------------------------------------------------
// Supervision : epargnes, credits, paiements, audit
// ------------------------------------------------------------------

export function listSavings(page: PageParams) {
  return paginate(
    page,
    (args) =>
      prisma.savings.findMany({
        include: { order: { select: { orderNumber: true, client: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: "desc" },
        ...args,
      }),
    () => prisma.savings.count()
  );
}

export function listCredits(page: PageParams) {
  return paginate(
    page,
    (args) =>
      prisma.credit.findMany({
        include: { creditRequest: { select: { bankId: true, clientId: true, status: true } }, order: { select: { orderNumber: true } } },
        orderBy: { createdAt: "desc" },
        ...args,
      }),
    () => prisma.credit.count()
  );
}

export function listPayments(page: PageParams, filters: { status?: "INITIE" | "EN_ATTENTE" | "CONFIRME" | "ECHOUE"; orderId?: string }) {
  const where: Prisma.PaymentWhereInput = { ...(filters.status ? { status: filters.status } : {}), ...(filters.orderId ? { orderId: filters.orderId } : {}) };
  return paginate(
    page,
    (args) => prisma.payment.findMany({ where, include: { order: { select: { orderNumber: true } } }, orderBy: { createdAt: "desc" }, ...args }),
    () => prisma.payment.count({ where })
  );
}

interface AuditFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  from?: Date;
  to?: Date;
}

export function listAuditLogs(page: PageParams, filters: AuditFilters) {
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lte: filters.to } } : {}),
  };
  return paginate(
    page,
    (args) => prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...args }),
    () => prisma.auditLog.count({ where })
  );
}

// ------------------------------------------------------------------
// Parametres financiers (back-office)
// ------------------------------------------------------------------

export function getFinancialSettings() {
  return getFinancialParams();
}

export async function patchFinancialSettings(adminUserId: string, patch: z.infer<typeof financialParamsPatchSchema>) {
  const updated = await updateFinancialParams(patch, adminUserId);
  await recordAudit({
    userId: adminUserId,
    actorRole: "ADMIN",
    action: "FINANCIAL_SETTINGS_UPDATED",
    entityType: "setting",
    entityId: "financial.params",
    metadata: { changedKeys: Object.keys(patch) },
  });
  return updated;
}

// ------------------------------------------------------------------
// Remboursement d'epargne et reglement commercant
// ------------------------------------------------------------------

export function refundSavings(adminUserId: string, savingsId: string, reference?: string) {
  return markSavingsRefunded(savingsId, adminUserId, reference);
}

export function listSettlements(page: PageParams, status?: "EN_ATTENTE" | "PAYE") {
  const where: Prisma.MerchantSettlementWhereInput = status ? { status } : {};
  return paginate(
    page,
    (args) =>
      prisma.merchantSettlement.findMany({
        where,
        include: {
          order: { select: { orderNumber: true } },
          merchant: { select: { id: true, firstName: true, lastName: true, orangeMoneyNumber: true, corisMoneyNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        ...args,
      }),
    () => prisma.merchantSettlement.count({ where })
  );
}

/**
 * L'Admin confirme que le reglement commercant a ete verse (virement Mobile Money execute).
 * Cloture : reglement PAYE, commande TERMINEE, credit TERMINE.
 */
export async function markSettlementPaid(adminUserId: string, settlementId: string, reference: string) {
  const settlement = await prisma.merchantSettlement.findUnique({ where: { id: settlementId }, include: { order: true, merchant: true } });
  if (!settlement) {
    throw AppError.notFound("Reglement introuvable");
  }
  if (settlement.status === "PAYE") {
    throw AppError.conflict("Ce reglement est deja marque comme paye");
  }
  assertTransition(settlement.order.status, "TERMINEE");

  await prisma.$transaction(async (tx) => {
    const flipped = await tx.merchantSettlement.updateMany({
      where: { id: settlementId, status: "EN_ATTENTE" },
      data: { status: "PAYE", payoutReference: reference, paidAt: new Date() },
    });
    if (flipped.count === 0) {
      throw AppError.conflict("Ce reglement est deja marque comme paye");
    }

    await tx.order.update({ where: { id: settlement.orderId }, data: { status: "TERMINEE" } });
    await tx.credit.updateMany({ where: { orderId: settlement.orderId, status: "FINANCE" }, data: { status: "TERMINE" } });
    await tx.payment.create({
      data: {
        orderId: settlement.orderId,
        kind: "MERCHANT_PAYOUT",
        amount: settlement.netAmount,
        provider: settlement.channel,
        providerTransactionId: reference,
        status: "CONFIRME",
        confirmedAt: new Date(),
      },
    });
    await recordAudit(
      {
        userId: adminUserId,
        actorRole: "ADMIN",
        action: "MERCHANT_SETTLEMENT_PAID",
        entityType: "merchant_settlement",
        entityId: settlementId,
        amount: settlement.netAmount,
        status: "PAYE",
        metadata: { reference, orderId: settlement.orderId },
      },
      tx
    );
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  await notifyUser(settlement.merchant.userId, "Reglement effectue", `${settlement.netAmount} FCFA vous ont ete verses (commande ${settlement.order.orderNumber}).`, {
    settlementId,
  });

  return { id: settlementId, status: "PAYE" as const, orderStatus: "TERMINEE" as const };
}
