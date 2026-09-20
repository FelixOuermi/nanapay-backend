import { Prisma } from "@prisma/client";
import { AppError } from "@common/errors/AppError";
import { recordAudit } from "@services/audit/auditService";
import { notifyUser } from "@services/notification/notificationService";
import { issueQrToken } from "@services/qr/qrService";
import { assertTransition } from "./orderStateMachine";

interface Actor {
  userId?: string;
  role?: string;
}

async function loadOrder(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { client: { select: { userId: true } } } });
  if (!order) {
    throw AppError.notFound("Commande introuvable");
  }
  return order;
}

/** Financement complet et valide : FINANCEMENT_EN_COURS -> FINANCEE. */
export async function markOrderFinanced(tx: Prisma.TransactionClient, orderId: string, actor?: Actor) {
  const order = await loadOrder(tx, orderId);
  assertTransition(order.status, "FINANCEE");

  const updated = await tx.order.update({ where: { id: orderId }, data: { status: "FINANCEE" } });
  await recordAudit(
    {
      userId: actor?.userId,
      actorRole: actor?.role,
      action: "ORDER_FINANCED",
      entityType: "order",
      entityId: orderId,
      amount: order.amount,
      status: "FINANCEE",
    },
    tx
  );
  return updated;
}

/**
 * FINANCEE -> PRETE_A_LIVRER et emission du jeton QR serveur (cahier, section 3 :
 * financement -> QR -> commercant -> retrait).
 */
export async function markOrderReadyForPickup(
  tx: Prisma.TransactionClient,
  orderId: string,
  qrTtlHours: number,
  actor?: Actor
) {
  const order = await loadOrder(tx, orderId);
  assertTransition(order.status, "PRETE_A_LIVRER");

  const updated = await tx.order.update({ where: { id: orderId }, data: { status: "PRETE_A_LIVRER" } });
  const qr = await issueQrToken(tx, orderId, qrTtlHours);

  await recordAudit(
    {
      userId: actor?.userId,
      actorRole: actor?.role,
      action: "ORDER_READY_FOR_PICKUP",
      entityType: "order",
      entityId: orderId,
      amount: order.amount,
      status: "PRETE_A_LIVRER",
    },
    tx
  );

  await notifyUser(
    order.client.userId,
    "Commande prete a livrer",
    `Votre commande ${order.orderNumber} est financee : votre code QR est disponible pour le retrait en boutique.`,
    { orderId },
    tx
  );

  return { order: updated, qr };
}

/** Enchaine les deux etapes (epargne 100 %, virement bancaire recu). */
export async function markOrderFinancedAndReady(
  tx: Prisma.TransactionClient,
  orderId: string,
  qrTtlHours: number,
  actor?: Actor
) {
  await markOrderFinanced(tx, orderId, actor);
  return markOrderReadyForPickup(tx, orderId, qrTtlHours, actor);
}
