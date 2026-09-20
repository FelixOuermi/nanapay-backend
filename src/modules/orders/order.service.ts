import { randomUUID } from "node:crypto";
import { FinancingMode, OrderStatus, Prisma } from "@prisma/client";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { PageParams, toSkipTake } from "@common/utils/response";
import { formatOrderNumber } from "@common/utils/orderNumber";
import { recordAudit } from "@services/audit/auditService";
import { getFinancialParams } from "@services/financial/settingsService";
import { issueQrToken } from "@services/qr/qrService";
import { evaluateSavingsDeadline } from "@modules/savings/savings.service";
import { assertTransition } from "./orderStateMachine";

const ORDER_DETAIL_INCLUDE = {
  product: { select: { id: true, title: true, price: true } },
  store: { select: { id: true, name: true } },
  savings: true,
  vault: true,
  creditRequest: true,
  credit: true,
} satisfies Prisma.OrderInclude;

/**
 * Une commande n'est visible que par son client. 404 (pas 403) pour ne pas confirmer
 * a un client l'existence de la commande d'un autre.
 */
export async function getOwnOrderOrThrow(clientId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_DETAIL_INCLUDE });
  if (!order || order.clientId !== clientId) {
    throw AppError.notFound("Commande introuvable");
  }
  return order;
}

/** Produit selectionne AVANT le mode de financement (cahier, section 6) : cree la commande. */
export async function createOrder(clientId: string, productId: string) {
  const order = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, deletedAt: null, isPublished: true, store: { merchant: { status: "VALIDE" } } },
    });

    if (!product) {
      throw AppError.notFound("Produit introuvable");
    }

    // Decrement conditionnel (stock > 0) : atomique au niveau DB, evite qu'une vente
    // concurrente ne fasse passer le stock en negatif.
    const reserved = await tx.product.updateMany({
      where: { id: product.id, stock: { gt: 0 } },
      data: { stock: { decrement: 1 } },
    });
    if (reserved.count === 0) {
      throw AppError.conflict("Ce produit est epuise");
    }

    // Le prix vient toujours de la base, jamais du frontend.
    const created = await tx.order.create({
      data: {
        orderNumber: `TMP-${randomUUID()}`,
        clientId,
        productId: product.id,
        storeId: product.storeId,
        amount: product.price,
      },
    });

    const numbered = await tx.order.update({
      where: { id: created.id },
      data: { orderNumber: formatOrderNumber(created.orderSeq, created.createdAt) },
      include: ORDER_DETAIL_INCLUDE,
    });

    await recordAudit(
      {
        actorRole: "CLIENT",
        action: "ORDER_CREATED",
        entityType: "order",
        entityId: numbered.id,
        amount: numbered.amount,
        status: "CREEE",
        metadata: { clientId, productId: product.id },
      },
      tx
    );

    return numbered;
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  return order;
}

export async function listOrders(clientId: string, page: PageParams, status?: OrderStatus) {
  const where: Prisma.OrderWhereInput = { clientId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { product: { select: { id: true, title: true } }, store: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(page),
    }),
    prisma.order.count({ where }),
  ]);
  return { items, total };
}

export async function getOrderDetail(clientId: string, orderId: string) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  // Echeance depassee : evaluee ici a la lecture (en plus du job periodique) pour que
  // le client voie toujours un etat a jour.
  if (order.savings) {
    const changed = await evaluateSavingsDeadline(order.savings.id);
    if (changed) {
      return getOwnOrderOrThrow(clientId, orderId);
    }
  }
  return order;
}

/**
 * Choix du mode de financement, une fois la commande creee. Coffre et Credit exigent un
 * profil de credit bancaire deja VALIDE (cahier, section 6) ; le backend est seul juge.
 */
export async function selectFinancing(clientId: string, orderId: string, mode: FinancingMode) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.cancelledAt) {
    throw AppError.conflict("Cette commande est annulee");
  }
  if (order.status !== "CREEE") {
    throw AppError.conflict(`Le financement ne peut plus etre choisi (statut : ${order.status})`);
  }
  assertTransition(order.status, "FINANCEMENT_EN_COURS");

  if (mode === "VAULT" || mode === "CREDIT") {
    const profile = await prisma.creditProfile.findUnique({ where: { clientId } });
    if (!profile || profile.status !== "VALIDE") {
      throw AppError.forbidden(
        mode === "VAULT"
          ? "Le Coffre est reserve aux salaries dont le profil credit bancaire est deja valide"
          : "Un profil credit valide par la banque est requis pour un financement par Credit"
      );
    }
    if (mode === "VAULT" && !profile.employer) {
      throw AppError.forbidden("Le Coffre est reserve aux salaries (employeur non renseigne)");
    }
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { financingMode: mode, status: "FINANCEMENT_EN_COURS" },
    include: ORDER_DETAIL_INCLUDE,
  });

  await recordAudit({
    actorRole: "CLIENT",
    action: "FINANCING_SELECTED",
    entityType: "order",
    entityId: orderId,
    amount: order.amount,
    status: "FINANCEMENT_EN_COURS",
    metadata: { mode },
  });

  return updated;
}

/**
 * Jeton QR a presenter au commercant : { qrToken, expiresAt }. Seule une commande
 * PRETE_A_LIVRER en dispose ; un jeton expire est regenere (l'ancien est invalide).
 */
export async function getOrderQr(clientId: string, orderId: string) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.status !== "PRETE_A_LIVRER") {
    throw AppError.forbidden("Le financement de cette commande n'est pas encore valide");
  }

  const active = await prisma.qRToken.findFirst({
    where: { orderId, status: "GENERE", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (active) {
    return { qrToken: active.token, expiresAt: active.expiresAt };
  }

  const params = await getFinancialParams();
  const fresh = await prisma.$transaction((tx) => issueQrToken(tx, orderId, params.qrTtlHours));
  return { qrToken: fresh.token, expiresAt: fresh.expiresAt };
}

/** Annule la commande et restitue le stock (echec definitif du financement). */
export async function cancelOrderAndRestock(tx: Prisma.TransactionClient, orderId: string, reason: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.cancelledAt) return;

  await tx.order.update({ where: { id: orderId }, data: { cancelledAt: new Date(), cancelReason: reason } });
  await tx.product.update({ where: { id: order.productId }, data: { stock: { increment: 1 } } });
}
