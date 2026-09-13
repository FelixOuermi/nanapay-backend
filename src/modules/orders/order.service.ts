import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { addMonths } from "@common/utils/date";
import { recordAudit } from "@services/audit/auditService";
import { getSavingsTerms, computeMaxCreditDurationMonths, canExtendSavingsDeadline } from "@services/financial/financialService";
import { checkAndApplyOverduePenalty } from "@modules/savings/savings.service";

interface CreateOrderInput {
  productId: string;
  paymentMode: "EPARGNE" | "CREDIT_BANCAIRE";
}

export async function createOrder(clientId: string, input: CreateOrderInput) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      include: { shop: { include: { merchant: true } } },
    });

    if (!product) {
      throw AppError.notFound("Article introuvable");
    }

    if (!product.isVisible || product.remainingStock <= 0) {
      throw AppError.conflict("Cet article n'est plus disponible");
    }

    // Sans numero Coris Money, le commercant ne peut pas recevoir de reversement Credit
    // Bancaire (cf. cahier, section "Compte Commercant") : seule l'Epargne reste possible.
    if (input.paymentMode === "CREDIT_BANCAIRE" && !product.shop.merchant.corisMoneyNumber) {
      throw AppError.badRequest(
        "Ce commercant n'accepte pas les paiements par Credit Bancaire (numero Coris Money manquant)"
      );
    }

    // Decrement conditionnel (remainingStock > 0) : atomique au niveau DB, evite qu'une
    // vente concurrente ne fasse passer le stock en negatif (cf. cahier, section 8).
    const decremented = await tx.product.updateMany({
      where: { id: product.id, remainingStock: { gt: 0 } },
      data: { remainingStock: { decrement: 1 } },
    });

    if (decremented.count === 0) {
      throw AppError.conflict("Cet article vient d'etre epuise, reessayez");
    }

    if (product.remainingStock - 1 <= 0) {
      await tx.product.update({ where: { id: product.id }, data: { isVisible: false } });
    }

    // Le prix vient toujours de la base, jamais du Front-end (cahier, section 8).
    const articlePrice = Number(product.price);

    if (input.paymentMode === "EPARGNE") {
      const terms = getSavingsTerms(articlePrice);

      const order = await tx.order.create({
        data: {
          clientId,
          productId: product.id,
          paymentMode: "EPARGNE",
          totalAmount: articlePrice,
          maxDurationMonths: terms.maxDurationMonths,
          savingsPlan: {
            create: {
              targetAmount: articlePrice,
              minInstallmentAmount: terms.minInstallmentAmount,
              dueDate: addMonths(new Date(), terms.maxDurationMonths),
            },
          },
        },
        include: { savingsPlan: true },
      });

      await recordAudit({
        action: "ORDER_CREATED_SAVINGS",
        entityType: "order",
        entityId: order.id,
        metadata: { clientId, productId: product.id, articlePrice },
      });

      return order;
    }

    // CREDIT_BANCAIRE : la commande est creee ici ; le dossier de credit (KYC, employeur,
    // autorisation de prelevement) est soumis ensuite via POST /orders/:id/bank-credit
    // et les modalites via POST /orders/:id/bank-credit/terms (module bankCredits, a venir).
    const maxDurationMonths = computeMaxCreditDurationMonths(articlePrice);

    const order = await tx.order.create({
      data: {
        clientId,
        productId: product.id,
        paymentMode: "CREDIT_BANCAIRE",
        totalAmount: articlePrice,
        maxDurationMonths,
      },
    });

    await recordAudit({
      action: "ORDER_CREATED_CREDIT",
      entityType: "order",
      entityId: order.id,
      metadata: { clientId, productId: product.id, articlePrice },
    });

    return order;
  }, INTERACTIVE_TRANSACTION_OPTIONS);
}

async function getOwnOrderOrThrow(clientId: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { savingsPlan: true, bankCredit: true, delivery: true, product: true },
  });

  // 404 (pas 403) pour ne pas confirmer a un client l'existence de la commande d'un autre.
  if (!order || order.clientId !== clientId) {
    throw AppError.notFound("Commande introuvable");
  }

  return order;
}

export async function getOrderDetail(clientId: string, orderId: string) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.savingsPlan) {
    await checkAndApplyOverduePenalty(order.savingsPlan, order);
    // Relit apres l'eventuelle application de la penalite pour renvoyer un etat a jour.
    return getOwnOrderOrThrow(clientId, orderId);
  }

  return order;
}

export async function extendSavingsDeadline(clientId: string, orderId: string, months: number) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.paymentMode !== "EPARGNE" || !order.savingsPlan) {
    throw AppError.badRequest("Cette commande n'est pas financee par Epargne");
  }

  if (order.savingsPlan.isCompleted) {
    throw AppError.conflict("Cette Epargne est deja terminee");
  }

  if (new Date() > order.savingsPlan.dueDate) {
    throw AppError.conflict("L'echeance est deja depassee, l'extension doit etre demandee avant");
  }

  if (!canExtendSavingsDeadline(order.extendedMonths, months)) {
    throw AppError.badRequest(
      `Extension refusee : maximum 2 mois au total (deja ${order.extendedMonths} mois accordes)`
    );
  }

  const [updatedOrder] = await prisma.$transaction([
    prisma.order.update({
      where: { id: order.id },
      data: { extendedMonths: { increment: months } },
    }),
    prisma.savingsPlan.update({
      where: { id: order.savingsPlan.id },
      data: { dueDate: addMonths(order.savingsPlan.dueDate, months) },
    }),
  ]);

  await recordAudit({
    action: "SAVINGS_DEADLINE_EXTENDED",
    entityType: "order",
    entityId: order.id,
    metadata: { months, totalExtendedMonths: updatedOrder.extendedMonths },
  });

  return getOwnOrderOrThrow(clientId, orderId);
}

export async function getOrderQrCode(clientId: string, orderId: string) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.status !== "PRET_A_LIVRER" || !order.qrCodeToken) {
    throw AppError.forbidden("Le financement de cette commande n'est pas encore valide");
  }

  return { orderId: order.id, qrCodeToken: order.qrCodeToken };
}
