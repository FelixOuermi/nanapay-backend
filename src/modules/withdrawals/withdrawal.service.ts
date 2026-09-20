import { timingSafeEqual } from "node:crypto";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { recordAudit } from "@services/audit/auditService";
import { notifyAdmins, notifyUser } from "@services/notification/notificationService";
import {
  computeCreditSettlement,
  computeSavingsSettlement,
} from "@services/financial/financialService";
import { getFinancialParams } from "@services/financial/settingsService";
import { assertTransition } from "@modules/orders/orderStateMachine";

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const ORDER_FOR_WITHDRAWAL = {
  product: { select: { id: true, title: true } },
  store: { select: { id: true, name: true, merchantId: true } },
  client: { select: { userId: true, firstName: true, lastName: true } },
} as const;

/**
 * Valide un jeton QR cote serveur (aucune confiance dans le contenu du QR lui-meme).
 * Retourne le jeton et sa commande si tout est conforme ; sinon leve une erreur precise.
 * Ne modifie rien, hors marquage EXPIRE d'un jeton dont la date est depassee.
 */
async function validateQrForMerchant(merchantId: string, presentedToken: string) {
  const qr = await prisma.qRToken.findUnique({
    where: { token: presentedToken },
    include: { order: { include: ORDER_FOR_WITHDRAWAL } },
  });

  // Meme reponse pour un jeton inconnu ou pour la commande d'une autre boutique : ne pas
  // reveler l'existence d'une commande a un commercant non autorise.
  if (!qr || !sameToken(qr.token, presentedToken) || qr.order.store.merchantId !== merchantId) {
    throw AppError.notFound("Code QR invalide");
  }

  if (qr.status === "UTILISE") {
    throw AppError.conflict("Code QR deja utilise (double retrait refuse)");
  }

  if (qr.status === "EXPIRE" || qr.expiresAt <= new Date()) {
    if (qr.status === "GENERE") {
      await prisma.qRToken.updateMany({ where: { id: qr.id, status: "GENERE" }, data: { status: "EXPIRE" } });
    }
    throw new AppError(410, "QR_EXPIRED", "Code QR expire : le client doit en regenerer un");
  }

  if (qr.order.status !== "PRETE_A_LIVRER") {
    throw AppError.conflict(`Commande non prete pour retrait (statut actuel : ${qr.order.status})`);
  }

  return qr;
}

/** POST /merchant/qr/scan : validation serveur du jeton, sans changement d'etat. */
export async function scanQr(merchantId: string, qrToken: string) {
  const qr = await validateQrForMerchant(merchantId, qrToken);
  const { order } = qr;

  await recordAudit({
    actorRole: "MERCHANT",
    action: "QR_SCANNED",
    entityType: "order",
    entityId: order.id,
    amount: order.amount,
    status: "GENERE",
    metadata: { merchantId },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    product: order.product,
    amount: order.amount,
    financingMode: order.financingMode,
    client: { firstName: order.client.firstName, lastName: order.client.lastName },
    qrExpiresAt: qr.expiresAt,
  };
}

/**
 * POST /merchant/orders/:id/withdrawal-confirm : le commercant confirme la remise de
 * l'article. Transition LIVREE, jeton UTILISE, reglement commercant declenche (cahier,
 * section 6 : paiement commercant apres retrait confirme).
 */
export async function confirmWithdrawal(merchantId: string, orderId: string, qrToken: string) {
  const qr = await validateQrForMerchant(merchantId, qrToken);
  if (qr.orderId !== orderId) {
    throw AppError.badRequest("Ce code QR ne correspond pas a cette commande");
  }

  const params = await getFinancialParams();
  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  const order = qr.order;
  assertTransition(order.status, "LIVREE");

  const settlementAmounts =
    order.financingMode === "CREDIT" ? computeCreditSettlement(order.amount, params) : computeSavingsSettlement(order.amount, params);

  const channel = merchant.defaultPayoutChannel;
  const payoutNumber = channel === "ORANGE_MONEY" ? merchant.orangeMoneyNumber : merchant.corisMoneyNumber;
  if (!payoutNumber) {
    throw AppError.badRequest("Aucun numero Mobile Money configure pour le canal de reglement du commercant");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Consommation atomique du jeton : deux confirmations simultanees ne peuvent pas reussir.
    const consumed = await tx.qRToken.updateMany({
      where: { id: qr.id, status: "GENERE", expiresAt: { gt: new Date() } },
      data: { status: "UTILISE", usedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw AppError.conflict("Code QR deja utilise ou expire");
    }

    const withdrawal = await tx.withdrawal.create({
      data: { orderId, merchantId, qrTokenId: qr.id },
    });

    await tx.order.update({ where: { id: orderId }, data: { status: "LIVREE" } });

    if (order.financingMode === "VAULT") {
      await tx.vault.updateMany({ where: { orderId }, data: { status: "UTILISE" } });
    }

    const settlement = await tx.merchantSettlement.create({
      data: {
        orderId,
        merchantId,
        grossAmount: order.amount,
        commissionRate: settlementAmounts.commissionRate,
        commissionAmount: settlementAmounts.commissionAmount,
        netAmount: settlementAmounts.netAmount,
        channel,
      },
    });

    await recordAudit(
      {
        actorRole: "MERCHANT",
        action: "WITHDRAWAL_CONFIRMED",
        entityType: "order",
        entityId: orderId,
        amount: order.amount,
        status: "LIVREE",
        metadata: { merchantId, withdrawalId: withdrawal.id, settlementId: settlement.id },
      },
      tx
    );

    return { withdrawal, settlement };
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  await notifyUser(order.client.userId, "Retrait confirme", `Votre article de la commande ${order.orderNumber} a ete remis en boutique.`, {
    orderId,
  });
  await notifyAdmins("Reglement commercant a effectuer", `Reglement de ${settlementAmounts.netAmount} FCFA a verser (commande ${order.orderNumber}).`, {
    settlementId: result.settlement.id,
    channel,
  });

  return {
    orderId,
    orderNumber: order.orderNumber,
    status: "LIVREE" as const,
    withdrawal: result.withdrawal,
    settlement: result.settlement,
  };
}
