import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { assertValidCreditDuration, computeBankWireAmount } from "@services/financial/financialService";
import { recordAudit } from "@services/audit/auditService";

async function getOwnOrderOrThrow(clientId: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { product: true, bankCredit: true },
  });

  if (!order || order.clientId !== clientId) {
    throw AppError.notFound("Commande introuvable");
  }

  return order;
}

interface SubmitDossierInput {
  employer: string;
  registrationNumber?: string;
  bankAuthorizationUrl: string;
  paySlipsUrl: string;
}

/**
 * Soumet le dossier de credit (identite deja capturee a l'inscription, employeur,
 * autorisation de prelevement signee, bulletins de salaire). Si le client a deja soumis
 * ces documents pour une commande precedente, ils sont reutilises sans nouvel upload
 * (cf. cahier: "le client peut a l'avenir payer ce qu'il veut sans retelecharger
 * l'autorisation").
 */
export async function submitOrReuseDossier(clientId: string, orderId: string, input?: SubmitDossierInput) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.paymentMode !== "CREDIT_BANCAIRE") {
    throw AppError.badRequest("Cette commande n'est pas financee par Credit Bancaire");
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    throw AppError.notFound("Profil client introuvable");
  }

  const dossierAlreadyOnFile = Boolean(client.employer && client.bankAuthorizationUrl && client.paySlipsUrl);

  if (dossierAlreadyOnFile) {
    return { dossierStatus: client.bankDossierStatus, reused: true };
  }

  if (!input) {
    throw AppError.badRequest(
      "Dossier de credit requis : employeur, autorisation de prelevement et bulletins de salaire"
    );
  }

  await prisma.client.update({
    where: { id: clientId },
    data: {
      employer: input.employer,
      registrationNumber: input.registrationNumber,
      bankAuthorizationUrl: input.bankAuthorizationUrl,
      paySlipsUrl: input.paySlipsUrl,
      bankDossierStatus: "EN_ATTENTE",
    },
  });

  await recordAudit({
    action: "BANK_CREDIT_DOSSIER_SUBMITTED",
    entityType: "client",
    entityId: clientId,
    metadata: { orderId },
  });

  return { dossierStatus: "EN_ATTENTE" as const, reused: false };
}

export async function setBankCreditTerms(clientId: string, orderId: string, months: number) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.paymentMode !== "CREDIT_BANCAIRE") {
    throw AppError.badRequest("Cette commande n'est pas financee par Credit Bancaire");
  }

  if (order.bankCredit) {
    throw AppError.conflict("Les modalites de credit ont deja ete enregistrees pour cette commande");
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  const dossierOnFile = client?.employer && client?.bankAuthorizationUrl && client?.paySlipsUrl;

  if (!dossierOnFile) {
    throw AppError.badRequest("Soumettez d'abord votre dossier via POST /orders/:id/bank-credit");
  }

  const articlePrice = Number(order.totalAmount);
  // Le Backend calcule/valide lui-meme la duree, il ne fait jamais confiance au Front-end.
  // financialService leve une Error generique (module pur, sans dependance a AppError) :
  // on la traduit ici en 400 pour ne pas renvoyer une 500 sur une simple erreur de saisie.
  try {
    assertValidCreditDuration(articlePrice, months);
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : "Duree de credit invalide");
  }

  const bank = await prisma.user.findFirst({ where: { role: "BANQUE", isActive: true } });
  if (!bank) {
    throw AppError.internal("Aucune banque partenaire disponible pour traiter ce dossier");
  }

  const { bankCommissionAmount, totalAmountToWire } = computeBankWireAmount(articlePrice);
  const monthlyInstallment = Math.ceil((totalAmountToWire / months) * 100) / 100;

  const bankCredit = await prisma.bankCredit.create({
    data: {
      orderId: order.id,
      bankId: bank.id,
      monthlyInstallment,
      bankCommissionAmount,
      totalAmountToWire,
    },
  });

  await recordAudit({
    action: "BANK_CREDIT_TERMS_SUBMITTED",
    entityType: "bank_credit",
    entityId: bankCredit.id,
    metadata: { orderId, months, totalAmountToWire },
  });

  return bankCredit;
}
