import { CreditProfileStatus, CreditRequestStatus, Prisma } from "@prisma/client";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { PageParams, toSkipTake } from "@common/utils/response";
import { recordAudit } from "@services/audit/auditService";
import { notifyAdmins, notifyUser } from "@services/notification/notificationService";
import { getFinancialParams } from "@services/financial/settingsService";
import { markOrderFinancedAndReady } from "@modules/orders/orderWorkflow";

// ------------------------------------------------------------------
// Profils de credit
// ------------------------------------------------------------------

export async function listCreditProfiles(bankId: string, page: PageParams, status: CreditProfileStatus = "EN_ANALYSE") {
  const where: Prisma.CreditProfileWhereInput = { bankId, status };
  const [items, total] = await Promise.all([
    prisma.creditProfile.findMany({
      where,
      include: { client: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } } },
      orderBy: { updatedAt: "asc" },
      ...toSkipTake(page),
    }),
    prisma.creditProfile.count({ where }),
  ]);
  return { items, total };
}

export async function decideCreditProfile(
  bankId: string,
  actorUserId: string,
  profileId: string,
  decision: "VALIDE" | "REFUSE",
  reason?: string
) {
  const profile = await prisma.creditProfile.findUnique({ where: { id: profileId }, include: { client: { select: { userId: true } } } });

  // 404 (pas 403) : ne confirme pas l'existence d'un profil assigne a une autre banque.
  if (!profile || profile.bankId !== bankId) {
    throw AppError.notFound("Profil credit introuvable");
  }
  if (profile.status !== "EN_ANALYSE") {
    throw AppError.conflict(`Ce profil a deja ete traite (statut : ${profile.status})`);
  }

  const flipped = await prisma.creditProfile.updateMany({
    where: { id: profileId, status: "EN_ANALYSE" },
    data: { status: decision, decisionReason: reason, decidedAt: new Date() },
  });
  if (flipped.count === 0) {
    throw AppError.conflict("Ce profil a deja ete traite");
  }

  await recordAudit({
    userId: actorUserId,
    actorRole: "BANK",
    action: decision === "VALIDE" ? "CREDIT_PROFILE_VALIDATED" : "CREDIT_PROFILE_REFUSED",
    entityType: "credit_profile",
    entityId: profileId,
    status: decision,
    metadata: { reason },
  });

  await notifyUser(
    profile.client.userId,
    decision === "VALIDE" ? "Profil credit valide" : "Profil credit refuse",
    decision === "VALIDE"
      ? "Votre profil bancaire est valide : Coffre et Credit sont disponibles."
      : `Votre profil credit a ete refuse${reason ? ` : ${reason}` : "."}`,
    { creditProfileId: profileId }
  );

  return { id: profileId, status: decision };
}

// ------------------------------------------------------------------
// Demandes de credit
// ------------------------------------------------------------------

export async function listCreditRequests(bankId: string, page: PageParams, status?: CreditRequestStatus) {
  const where: Prisma.CreditRequestWhereInput = {
    bankId,
    status: status ?? { in: ["ENVOYEE", "EN_ANALYSE"] },
  };
  const [items, total] = await Promise.all([
    prisma.creditRequest.findMany({
      where,
      include: {
        client: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        order: { select: { orderNumber: true, product: { select: { title: true } } } },
        credit: true,
      },
      orderBy: { createdAt: "asc" },
      ...toSkipTake(page),
    }),
    prisma.creditRequest.count({ where }),
  ]);
  return { items, total };
}

// ------------------------------------------------------------------
// Avis de virement banque -> NanoPay
// ------------------------------------------------------------------

interface TransferNoticeInput {
  creditId: string;
  transferReference: string;
  amount: number;
}

/**
 * POST /bank/transfers/notice : la banque signale avoir vire les fonds. Le montant doit
 * correspondre exactement au montant a virer calcule par le backend (prix + frais). La
 * reference de virement est UNIQUE : un meme avis n'est jamais comptabilise deux fois.
 * Credit FINANCE, commande FINANCEE puis PRETE_A_LIVRER avec jeton QR.
 */
export async function noticeTransfer(bankId: string, actorUserId: string, input: TransferNoticeInput) {
  const credit = await prisma.credit.findUnique({ where: { id: input.creditId }, include: { creditRequest: true, order: true } });

  if (!credit || credit.creditRequest.bankId !== bankId) {
    throw AppError.notFound("Credit introuvable");
  }
  if (credit.status !== "EN_ATTENTE_DE_VIREMENT") {
    throw AppError.conflict(`Aucun virement attendu pour ce credit (statut : ${credit.status})`);
  }
  if (input.amount !== credit.totalAmountToWire) {
    throw AppError.unprocessable(`Montant incorrect : ${credit.totalAmountToWire} FCFA attendus`, {
      expected: credit.totalAmountToWire,
      received: input.amount,
    });
  }

  const params = await getFinancialParams();

  await prisma.$transaction(async (tx) => {
    const flipped = await tx.credit.updateMany({
      where: { id: credit.id, status: "EN_ATTENTE_DE_VIREMENT" },
      data: { status: "FINANCE", transferReference: input.transferReference, transferNotedAt: new Date() },
    });
    if (flipped.count === 0) {
      throw AppError.conflict("Ce virement a deja ete enregistre");
    }

    await tx.payment.create({
      data: {
        orderId: credit.orderId,
        kind: "BANK_TRANSFER",
        amount: input.amount,
        provider: "BANK",
        providerTransactionId: input.transferReference,
        status: "CONFIRME",
        confirmedAt: new Date(),
      },
    });

    await recordAudit(
      {
        userId: actorUserId,
        actorRole: "BANK",
        action: "BANK_TRANSFER_NOTICED",
        entityType: "credit",
        entityId: credit.id,
        amount: input.amount,
        status: "FINANCE",
        metadata: { transferReference: input.transferReference, orderId: credit.orderId },
      },
      tx
    );

    await markOrderFinancedAndReady(tx, credit.orderId, params.qrTtlHours, { userId: actorUserId, role: "BANK" });
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  await notifyAdmins("Virement banque recu", `Virement de ${input.amount} FCFA annonce (commande ${credit.order.orderNumber}).`, {
    creditId: credit.id,
    transferReference: input.transferReference,
  });

  return { creditId: credit.id, status: "FINANCE" as const, orderId: credit.orderId };
}
