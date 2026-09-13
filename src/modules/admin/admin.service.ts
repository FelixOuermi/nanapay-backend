import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { generateTemporaryPassword, hashPassword } from "@common/utils/password";
import { sendAccountApprovedEmail, sendAccountRejectedEmail } from "@services/email/emailService";
import { recordAudit } from "@services/audit/auditService";
import { createMerchantPayoutForOrder } from "@modules/payouts/payout.service";
import { notifyUser } from "@services/notification/notificationService";

const PENDING_CLIENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  city: true,
  township: true,
  sector: true,
  cnibRectoUrl: true,
  cnibVersoUrl: true,
  createdAt: true,
  user: { select: { id: true, email: true, accountStatus: true, createdAt: true } },
} as const;

const PENDING_MERCHANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  ifuRccmNumber: true,
  city: true,
  orangeMoneyNumber: true,
  corisMoneyNumber: true,
  defaultPayoutAccount: true,
  cnibRectoUrl: true,
  cnibVersoUrl: true,
  createdAt: true,
  user: { select: { id: true, email: true, accountStatus: true, createdAt: true } },
} as const;

export async function listPendingClients() {
  return prisma.client.findMany({
    where: { user: { accountStatus: "PENDING" } },
    select: PENDING_CLIENT_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

export async function listPendingMerchants() {
  return prisma.merchant.findMany({
    where: { user: { accountStatus: "PENDING" } },
    select: PENDING_MERCHANT_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

async function findPendingUserOrThrow(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw AppError.notFound("Dossier introuvable");
  }

  if (user.accountStatus !== "PENDING") {
    throw AppError.conflict(`Ce dossier a deja ete traite (statut actuel: ${user.accountStatus})`);
  }

  return user;
}

export async function approveClient(clientId: string, adminId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw AppError.notFound("Client introuvable");
  }

  const user = await findPendingUserOrThrow(client.userId);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: true, accountStatus: "APPROVED", passwordHash },
  });

  await sendAccountApprovedEmail(user.email, temporaryPassword);
  await notifyUser(user.id, "Compte valide", "Votre compte NanaPay a ete valide, vous pouvez vous connecter.");
  await recordAudit({
    userId: adminId,
    action: "CLIENT_APPROVED",
    entityType: "client",
    entityId: clientId,
    metadata: { approvedUserId: user.id },
  });

  return { id: clientId, status: "APPROVED" as const };
}

export async function rejectClient(clientId: string, adminId: string, reason?: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw AppError.notFound("Client introuvable");
  }

  const user = await findPendingUserOrThrow(client.userId);

  await prisma.user.update({ where: { id: user.id }, data: { accountStatus: "REJECTED" } });

  await sendAccountRejectedEmail(user.email, reason);
  // Pas de notifyUser ici : un compte rejete ne peut jamais se connecter (isActive
  // reste false), la notification serait donc inaccessible. L'e-mail suffit.
  await recordAudit({
    userId: adminId,
    action: "CLIENT_REJECTED",
    entityType: "client",
    entityId: clientId,
    metadata: { rejectedUserId: user.id, reason },
  });

  return { id: clientId, status: "REJECTED" as const };
}

export async function approveMerchant(merchantId: string, adminId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    throw AppError.notFound("Commercant introuvable");
  }

  const user = await findPendingUserOrThrow(merchant.userId);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { isActive: true, accountStatus: "APPROVED", passwordHash },
    }),
    prisma.merchant.update({ where: { id: merchantId }, data: { isVerified: true } }),
  ]);

  await sendAccountApprovedEmail(user.email, temporaryPassword);
  await notifyUser(user.id, "Compte valide", "Votre compte NanaPay a ete valide, vous pouvez vous connecter.");
  await recordAudit({
    userId: adminId,
    action: "MERCHANT_APPROVED",
    entityType: "merchant",
    entityId: merchantId,
    metadata: { approvedUserId: user.id },
  });

  return { id: merchantId, status: "APPROVED" as const };
}

export async function rejectMerchant(merchantId: string, adminId: string, reason?: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    throw AppError.notFound("Commercant introuvable");
  }

  const user = await findPendingUserOrThrow(merchant.userId);

  await prisma.user.update({ where: { id: user.id }, data: { accountStatus: "REJECTED" } });

  await sendAccountRejectedEmail(user.email, reason);
  await recordAudit({
    userId: adminId,
    action: "MERCHANT_REJECTED",
    entityType: "merchant",
    entityId: merchantId,
    metadata: { rejectedUserId: user.id, reason },
  });

  return { id: merchantId, status: "REJECTED" as const };
}

/**
 * Suivi des epargnes : identifiants client + evolution, "cadre rouge" (en cours) ou
 * "cadre vert" (terminee) selon isCompleted (cf. cahier, section Admin).
 */
export async function listSavingsOverview() {
  const orders = await prisma.order.findMany({
    where: { paymentMode: "EPARGNE" },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
      product: { select: { title: true } },
      savingsPlan: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return orders
    .filter((order) => order.savingsPlan)
    .map((order) => {
      const plan = order.savingsPlan!;
      const targetAmount = Number(plan.targetAmount);
      const currentSavedAmount = Number(plan.currentSavedAmount);

      return {
        orderId: order.id,
        client: order.client,
        productTitle: order.product.title,
        status: order.status,
        targetAmount,
        currentSavedAmount,
        progressPercent: targetAmount > 0 ? Math.min(100, Math.round((currentSavedAmount / targetAmount) * 100)) : 0,
        dueDate: plan.dueDate,
        cadre: plan.isCompleted ? ("VERT" as const) : ("ROUGE" as const),
        penaltyApplied: plan.penaltyApplied,
      };
    });
}

export async function listCreditsOverview() {
  return prisma.bankCredit.findMany({
    include: {
      order: {
        include: {
          client: { select: { id: true, firstName: true, lastName: true } },
          product: {
            select: {
              title: true,
              shop: { select: { merchant: { select: { id: true, firstName: true, lastName: true, corisMoneyNumber: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Procede au virement commercant pour un Credit Bancaire, une fois le virement de la
 * Banque vers NanaPay recu (cf. cahier: "avec un bouton proceder au virement").
 * Distinct du scan QR : la livraison physique et ce reversement sont deux evenements
 * independants pour le Credit Bancaire (contrairement a l'Epargne, ou le scan suffit).
 */
export async function processCreditPayout(bankCreditId: string, adminId: string) {
  const bankCredit = await prisma.bankCredit.findUnique({
    where: { id: bankCreditId },
    include: { order: { include: { product: { include: { shop: true } }, savingsPlan: true } } },
  });

  if (!bankCredit) {
    throw AppError.notFound("Dossier de credit introuvable");
  }

  if (bankCredit.transferStatus !== "VIREMENT_BANQUE_EFFECTUE") {
    throw AppError.conflict(
      `Le virement de la banque doit d'abord etre recu (statut actuel: ${bankCredit.transferStatus})`
    );
  }

  const merchantId = bankCredit.order.product.shop.merchantId;

  const payout = await prisma.$transaction(async (tx) => {
    const created = await createMerchantPayoutForOrder(tx, bankCredit.order, merchantId);
    await tx.bankCredit.update({ where: { id: bankCredit.id }, data: { transferStatus: "PAYE_AU_COMMERCANT" } });
    return created;
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  await recordAudit({
    userId: adminId,
    action: "CREDIT_MERCHANT_PAYOUT_PROCESSED",
    entityType: "bank_credit",
    entityId: bankCredit.id,
    metadata: { payoutId: payout.id, merchantId },
  });

  return payout;
}

/**
 * Vue synthetique des mouvements financiers : depots Epargne (argent recu) et
 * reversements commercants (argent verse). Aucune table "transactions" dediee n'existe
 * dans le schema fourni ; cette vue les agrege en lecture seule pour le suivi Admin.
 */
export async function listTransactions() {
  const [savingsDeposits, merchantPayouts] = await Promise.all([
    prisma.savingsDeposit.findMany({
      include: { savingsPlan: { include: { order: { select: { id: true, clientId: true } } } } },
      orderBy: { depositDate: "desc" },
      take: 100,
    }),
    prisma.merchantPayout.findMany({
      include: { order: { select: { id: true } }, merchant: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { payoutDate: "desc" },
      take: 100,
    }),
  ]);

  return { savingsDeposits, merchantPayouts };
}

export async function listAdminNotifications(adminId: string) {
  return prisma.notification.findMany({
    where: { userId: adminId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
