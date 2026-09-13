import { timingSafeEqual } from "node:crypto";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { recordAudit } from "@services/audit/auditService";
import { notifyUser } from "@services/notification/notificationService";
import { createMerchantPayoutForOrder } from "@modules/payouts/payout.service";

function tokensMatch(expected: string, presented: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);

  if (expectedBuffer.length !== presentedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

export async function scanQrCode(merchantId: string, orderId: string, presentedToken: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { product: { include: { shop: true } }, savingsPlan: true, client: { select: { userId: true } } },
  });

  // 404 (pas 403) : ne confirme pas a un commercant non autorise l'existence de la commande.
  if (!order || order.product.shop.merchantId !== merchantId) {
    throw AppError.notFound("Commande introuvable");
  }

  if (order.status === "LIVRE") {
    throw AppError.conflict("Commande deja livree (double scan refuse)");
  }

  if (order.status !== "PRET_A_LIVRER" || !order.qrCodeToken) {
    throw AppError.conflict(`Commande non prete pour retrait (statut actuel: ${order.status})`);
  }

  if (!tokensMatch(order.qrCodeToken, presentedToken)) {
    throw AppError.badRequest("Code QR invalide");
  }

  // Le reversement commercant n'est declenche ici que pour l'Epargne : "cadre vert
  // (epargne terminee) ET QR scanne" (cf. cahier, section Admin > Gestion des epargnes).
  // Pour le Credit Bancaire, le reversement est declenche separement par l'Admin via
  // POST /admin/credits/:id/payout, une fois le virement de la banque recu — la
  // livraison physique de l'article et le reversement au commercant sont deux
  // evenements distincts dans ce cas (cf. cahier, section Admin > Gestion des credits).
  const { updatedOrder, payout } = await prisma.$transaction(async (tx) => {
    await tx.orderDelivery.create({
      data: { orderId: order.id, scannedByMerchantId: merchantId, verificationStatus: "CONFIRME" },
    });

    const updated = await tx.order.update({ where: { id: order.id }, data: { status: "LIVRE" } });

    const createdPayout =
      order.paymentMode === "EPARGNE"
        ? await createMerchantPayoutForOrder(tx, { ...order, ...updated }, merchantId)
        : null;

    return { updatedOrder: updated, payout: createdPayout };
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  await recordAudit({
    action: "ORDER_DELIVERED",
    entityType: "order",
    entityId: order.id,
    metadata: { merchantId, payoutId: payout?.id },
  });

  await notifyUser(order.client.userId, "Commande livree", "Votre article a ete remis en boutique.");

  return { order: updatedOrder, payout };
}
