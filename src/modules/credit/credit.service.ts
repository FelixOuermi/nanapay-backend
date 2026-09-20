import { CreditRequestStatus, Prisma } from "@prisma/client";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { recordAudit } from "@services/audit/auditService";
import { notifyUser } from "@services/notification/notificationService";
import { computeCreditTerms } from "@services/financial/financialService";
import { getFinancialParams } from "@services/financial/settingsService";
import { getOwnOrderOrThrow } from "@modules/orders/order.service";

// ------------------------------------------------------------------
// Profil de credit bancaire (valide une fois par la banque, reutilisable ensuite)
// ------------------------------------------------------------------

export async function getCreditProfile(clientId: string) {
  const profile = await prisma.creditProfile.findUnique({ where: { clientId } });
  // Un client sans profil est NON_CONFIGURE ; on ne cree pas de ligne pour une simple lecture.
  return (
    profile ?? {
      clientId,
      status: "NON_CONFIGURE" as const,
      employer: null,
      registrationNumber: null,
      decisionReason: null,
      decidedAt: null,
    }
  );
}

interface SubmitProfileInput {
  employer: string;
  registrationNumber?: string;
  bankAuthorizationUrl: string;
  paySlipsUrl: string;
}

export async function submitCreditProfile(clientId: string, userId: string, input: SubmitProfileInput) {
  const existing = await prisma.creditProfile.findUnique({ where: { clientId } });

  if (existing && (existing.status === "EN_ANALYSE" || existing.status === "VALIDE")) {
    throw AppError.conflict(
      existing.status === "VALIDE" ? "Votre profil credit est deja valide" : "Votre profil credit est deja en cours d'analyse"
    );
  }

  // Banque partenaire assignee au dossier (une seule banque partenaire a ce stade).
  const bank = await prisma.bank.findFirst({ orderBy: { createdAt: "asc" }, include: { user: { select: { isActive: true } } } });
  if (!bank || !bank.user.isActive) {
    throw AppError.internal("Aucune banque partenaire disponible pour analyser ce profil");
  }

  const data = {
    bankId: bank.id,
    employer: input.employer,
    registrationNumber: input.registrationNumber,
    bankAuthorizationUrl: input.bankAuthorizationUrl,
    paySlipsUrl: input.paySlipsUrl,
    status: "EN_ANALYSE" as const,
    decisionReason: null,
    decidedAt: null,
  };

  const profile = await prisma.creditProfile.upsert({
    where: { clientId },
    create: { clientId, ...data },
    update: data,
  });

  await recordAudit({
    userId,
    actorRole: "CLIENT",
    action: "CREDIT_PROFILE_SUBMITTED",
    entityType: "credit_profile",
    entityId: profile.id,
    status: profile.status,
  });
  await notifyUser(bank.userId, "Nouveau profil credit a analyser", "Un client a soumis son profil credit.", { creditProfileId: profile.id });

  return profile;
}

// ------------------------------------------------------------------
// Demande de credit liee a une commande
// ------------------------------------------------------------------

export async function createCreditRequest(clientId: string, orderId: string, durationMonths: number) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.cancelledAt) {
    throw AppError.conflict("Cette commande est annulee");
  }
  if (order.financingMode !== "CREDIT" || order.status !== "FINANCEMENT_EN_COURS") {
    throw AppError.conflict("Choisissez d'abord le financement par Credit (POST /orders/:id/select-financing)");
  }
  if (order.creditRequest) {
    throw AppError.conflict("Une demande de credit existe deja pour cette commande");
  }

  const profile = await prisma.creditProfile.findUnique({ where: { clientId } });
  if (!profile || profile.status !== "VALIDE" || !profile.bankId) {
    throw AppError.forbidden("Un profil credit valide par la banque est requis");
  }

  const params = await getFinancialParams();
  let terms;
  try {
    // Le backend calcule et valide lui-meme duree, frais et mensualite.
    terms = computeCreditTerms(order.amount, durationMonths, params);
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : "Duree de credit invalide");
  }

  const request = await prisma.creditRequest.create({
    data: {
      orderId,
      clientId,
      bankId: profile.bankId,
      amount: order.amount,
      durationMonths,
      monthlyInstallment: terms.monthlyInstallment,
      bankFeeAmount: terms.bankFeeAmount,
      totalAmountToWire: terms.totalAmountToWire,
      status: "ENVOYEE",
    },
    include: { bank: { select: { userId: true } } },
  });

  await recordAudit({
    actorRole: "CLIENT",
    action: "CREDIT_REQUEST_SENT",
    entityType: "credit_request",
    entityId: request.id,
    amount: request.amount,
    status: request.status,
    metadata: { orderId, durationMonths },
  });
  await notifyUser(request.bank.userId, "Nouvelle demande de credit", `Demande de credit de ${request.amount} FCFA.`, {
    creditRequestId: request.id,
  });

  return request;
}

export async function getCreditRequest(clientId: string, requestId: string) {
  const request = await prisma.creditRequest.findUnique({ where: { id: requestId }, include: { credit: true } });
  if (!request || request.clientId !== clientId) {
    throw AppError.notFound("Demande de credit introuvable");
  }
  return request;
}

export async function getCredit(clientId: string, creditId: string) {
  const credit = await prisma.credit.findUnique({ where: { id: creditId }, include: { creditRequest: true } });
  if (!credit || credit.creditRequest.clientId !== clientId) {
    throw AppError.notFound("Credit introuvable");
  }
  return credit;
}

// ------------------------------------------------------------------
// Decisions de la banque
// ------------------------------------------------------------------

export type RequestDecision = "ACCEPTEE" | "REFUSEE";

const DECIDABLE_STATUSES: CreditRequestStatus[] = ["ENVOYEE", "EN_ANALYSE"];

/**
 * Decision de la banque sur une demande. ACCEPTEE cree le Credit (en attente du virement
 * banque -> NanoPay). REFUSEE remet la commande a CREEE pour que le client choisisse un
 * autre financement.
 */
export async function decideCreditRequest(bankId: string, requestId: string, decision: RequestDecision, reason?: string, actorUserId?: string) {
  const request = await prisma.creditRequest.findUnique({ where: { id: requestId }, include: { client: { select: { userId: true } } } });

  // 404 (pas 403) : ne confirme pas a une banque l'existence d'un dossier qui ne lui est pas assigne.
  if (!request || request.bankId !== bankId) {
    throw AppError.notFound("Demande de credit introuvable");
  }
  if (!DECIDABLE_STATUSES.includes(request.status)) {
    throw AppError.conflict(`Cette demande a deja ete traitee (statut : ${request.status})`);
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Passage conditionnel : deux decisions simultanees ne peuvent pas toutes deux aboutir.
    const flipped = await tx.creditRequest.updateMany({
      where: { id: requestId, status: { in: DECIDABLE_STATUSES } },
      data: { status: decision, decisionReason: reason, decidedAt: new Date() },
    });
    if (flipped.count === 0) {
      throw AppError.conflict("Cette demande a deja ete traitee");
    }

    if (decision === "ACCEPTEE") {
      await tx.credit.create({
        data: {
          creditRequestId: requestId,
          orderId: request.orderId,
          amount: request.amount,
          durationMonths: request.durationMonths,
          monthlyInstallment: request.monthlyInstallment,
          totalAmountToWire: request.totalAmountToWire,
          status: "EN_ATTENTE_DE_VIREMENT",
        },
      });
    } else {
      await tx.order.update({
        where: { id: request.orderId },
        data: { status: "CREEE", financingMode: null },
      });
    }

    await recordAudit(
      {
        userId: actorUserId,
        actorRole: "BANK",
        action: decision === "ACCEPTEE" ? "CREDIT_REQUEST_ACCEPTED" : "CREDIT_REQUEST_REFUSED",
        entityType: "credit_request",
        entityId: requestId,
        amount: request.amount,
        status: decision,
        metadata: { reason },
      },
      tx
    );
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  await notifyUser(
    request.client.userId,
    decision === "ACCEPTEE" ? "Credit accepte" : "Credit refuse",
    decision === "ACCEPTEE"
      ? "Votre demande de credit est acceptee, en attente du virement de la banque."
      : `Votre demande de credit a ete refusee${reason ? ` : ${reason}` : "."}`,
    { creditRequestId: requestId, orderId: request.orderId }
  );

  return { id: requestId, status: decision };
}
