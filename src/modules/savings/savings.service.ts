import { Order, SavingsPlan, MobileMoneyOperator, Prisma } from "@prisma/client";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { daysBetween } from "@common/utils/date";
import { computeSavingsPenalty } from "@services/financial/financialService";
import { generateQrToken } from "@services/qr/qrService";
import { recordAudit } from "@services/audit/auditService";
import { notifyUser } from "@services/notification/notificationService";
import { logger } from "@config/logger";

export async function listClientSavings(clientId: string) {
  const orders = await prisma.order.findMany({
    where: { clientId, paymentMode: "EPARGNE" },
    include: { savingsPlan: true, product: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
  });

  const results = [];
  for (const order of orders) {
    if (order.savingsPlan) {
      await checkAndApplyOverduePenalty(order.savingsPlan, order);
    }
    results.push(order);
  }

  // Relit apres les eventuelles penalites appliquees pour renvoyer un etat a jour.
  const refreshed = await prisma.order.findMany({
    where: { clientId, paymentMode: "EPARGNE" },
    include: { savingsPlan: true, product: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
  });

  return refreshed.map((order) => {
    const plan = order.savingsPlan;
    const targetAmount = plan ? Number(plan.targetAmount) : 0;
    const currentSavedAmount = plan ? Number(plan.currentSavedAmount) : 0;

    return {
      orderId: order.id,
      productTitle: order.product.title,
      status: order.status,
      targetAmount,
      currentSavedAmount,
      progressPercent: targetAmount > 0 ? Math.min(100, Math.round((currentSavedAmount / targetAmount) * 100)) : 0,
      remainingAmount: Math.max(0, targetAmount - currentSavedAmount),
      dueDate: plan?.dueDate ?? null,
      daysRemaining: plan ? daysBetween(new Date(), plan.dueDate) : null,
      isCompleted: plan?.isCompleted ?? false,
      penaltyApplied: plan?.penaltyApplied ?? false,
    };
  });
}

/**
 * A appeler de maniere opportuniste (lecture de commande/epargne, reception d'un depot)
 * tant qu'aucun job planifie ne parcourt les echeances en tache de fond. Applique la
 * regle actuelle : penalite de 15%, remboursement de 85%, blocage temporaire du compte.
 */
export async function checkAndApplyOverduePenalty(savingsPlan: SavingsPlan, order: Order): Promise<void> {
  if (savingsPlan.isCompleted || savingsPlan.penaltyApplied) {
    return;
  }

  if (new Date() <= savingsPlan.dueDate) {
    return;
  }

  const { penaltyAmount, refundAmount } = computeSavingsPenalty(Number(savingsPlan.currentSavedAmount));
  const client = await prisma.client.findUnique({ where: { id: order.clientId } });

  await prisma.$transaction([
    prisma.savingsPlan.update({ where: { id: savingsPlan.id }, data: { penaltyApplied: true } }),
    prisma.order.update({ where: { id: order.id }, data: { status: "ECHEC_PENALISE" } }),
    ...(client ? [prisma.user.update({ where: { id: client.userId }, data: { isActive: false } })] : []),
  ]);

  // Le remboursement de 85% doit partir vers le numero Mobile Money utilise par le
  // client pour ses versements ; ce numero n'est pas encore capture par savings_deposits
  // et l'integration Orange/Coris Money reste a brancher (cf. services/payment).
  // Le virement est donc a executer manuellement par l'Admin tant que ces deux pieces
  // ne sont pas en place : les montants exacts sont journalises ci-dessous pour cela.
  logger.warn("Penalite Epargne appliquee : remboursement a executer manuellement", {
    orderId: order.id,
    savingsPlanId: savingsPlan.id,
    penaltyAmount,
    refundAmount,
  });

  await recordAudit({
    action: "SAVINGS_PENALTY_APPLIED",
    entityType: "order",
    entityId: order.id,
    metadata: { savingsPlanId: savingsPlan.id, penaltyAmount, refundAmount },
  });

  if (client) {
    await notifyUser(
      client.userId,
      "Penalite appliquee sur votre Epargne",
      `Le delai de votre Epargne est depasse. Penalite de ${penaltyAmount} FCFA appliquee, remboursement de ${refundAmount} FCFA en cours. Votre compte est temporairement bloque.`
    );
  }
}

interface ProcessDepositInput {
  orderId: string;
  transactionReference: string;
  amount: number;
  operator: MobileMoneyOperator;
}

export async function processSavingsDeposit(input: ProcessDepositInput) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { savingsPlan: true, client: { select: { userId: true } } },
  });

  if (!order || order.paymentMode !== "EPARGNE" || !order.savingsPlan) {
    throw AppError.badRequest("Reference de commande Epargne invalide");
  }

  const savingsPlan = order.savingsPlan;

  // Idempotence : la contrainte UNIQUE sur transaction_reference est la source de verite ;
  // si le depot existe deja, on renvoie l'etat courant sans reappliquer les effets metier
  // (cf. cahier, section 14 et "Tests webhook avec evenement duplique").
  const existingDeposit = await prisma.savingsDeposit.findUnique({
    where: { transactionReference: input.transactionReference },
  });
  if (existingDeposit) {
    return { alreadyProcessed: true, orderId: order.id };
  }

  if (savingsPlan.isCompleted || order.status !== "EN_COURS") {
    throw AppError.conflict("Cette Epargne n'accepte plus de nouveaux depots");
  }

  const newSavedAmount = Number(savingsPlan.currentSavedAmount) + input.amount;
  const targetAmount = Number(savingsPlan.targetAmount);
  const isNowCompleted = newSavedAmount >= targetAmount;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.savingsDeposit.create({
        data: {
          savingsPlanId: savingsPlan.id,
          amount: input.amount,
          transactionReference: input.transactionReference,
          operator: input.operator,
          status: "SUCCESS",
        },
      });

      await tx.savingsPlan.update({
        where: { id: savingsPlan.id },
        data: { currentSavedAmount: newSavedAmount, isCompleted: isNowCompleted },
      });

      if (isNowCompleted) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: "PRET_A_LIVRER", qrCodeToken: generateQrToken() },
        });
      }
    }, INTERACTIVE_TRANSACTION_OPTIONS);
  } catch (error) {
    // Deux webhooks strictement simultanes pour le meme evenement peuvent tous les deux
    // passer le controle "existingDeposit" ci-dessus avant que l'un des deux n'insere :
    // la contrainte UNIQUE sur transaction_reference tranche alors au niveau DB (P2002).
    // C'est le meme cas que le rejeu detecte plus haut, traite de la meme facon.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { alreadyProcessed: true, orderId: order.id };
    }
    throw error;
  }

  await recordAudit({
    action: isNowCompleted ? "SAVINGS_PLAN_COMPLETED" : "SAVINGS_DEPOSIT_RECEIVED",
    entityType: "order",
    entityId: order.id,
    metadata: { amount: input.amount, transactionReference: input.transactionReference, newSavedAmount },
  });

  await notifyUser(
    order.client.userId,
    isNowCompleted ? "Epargne terminee" : "Depot recu",
    isNowCompleted
      ? "Votre Epargne est terminee, votre code QR est disponible pour le retrait en boutique."
      : `Depot de ${input.amount} FCFA recu, ${newSavedAmount} FCFA epargnes sur ${targetAmount} FCFA.`
  );

  return { alreadyProcessed: false, orderId: order.id, isCompleted: isNowCompleted };
}
