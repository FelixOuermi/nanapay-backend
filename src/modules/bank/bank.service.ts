import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { generateQrToken } from "@services/qr/qrService";
import { recordAudit } from "@services/audit/auditService";
import { notifyAdmins, notifyUser } from "@services/notification/notificationService";

const CREDIT_REQUEST_INCLUDE = {
  order: {
    include: {
      product: { include: { shop: { include: { merchant: true } } } },
      client: true,
    },
  },
} as const;

async function getOwnBankCreditOrThrow(bankId: string, bankCreditId: string) {
  const bankCredit = await prisma.bankCredit.findUnique({
    where: { id: bankCreditId },
    include: CREDIT_REQUEST_INCLUDE,
  });

  // 404 (pas 403) : ne confirme pas a une banque l'existence d'un dossier qui ne lui est pas assigne.
  if (!bankCredit || bankCredit.bankId !== bankId) {
    throw AppError.notFound("Dossier de credit introuvable");
  }

  return bankCredit;
}

export async function listCreditRequests(bankId: string) {
  return prisma.bankCredit.findMany({
    where: { bankId, approvalStatus: "EN_ATTENTE" },
    include: CREDIT_REQUEST_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

export async function getCreditRequestDetail(bankId: string, bankCreditId: string) {
  return getOwnBankCreditOrThrow(bankId, bankCreditId);
}

export async function approveCreditRequest(bankId: string, bankCreditId: string) {
  const bankCredit = await getOwnBankCreditOrThrow(bankId, bankCreditId);

  if (bankCredit.approvalStatus !== "EN_ATTENTE") {
    throw AppError.conflict(`Ce dossier a deja ete traite (statut: ${bankCredit.approvalStatus})`);
  }

  await prisma.$transaction([
    prisma.bankCredit.update({
      where: { id: bankCredit.id },
      data: { approvalStatus: "APPROUVE", approvalDate: new Date() },
    }),
    // Autorisation de prelevement validee : reutilisable pour les futurs achats du client
    // sans re-upload (cf. cahier, section 6).
    prisma.client.update({ where: { id: bankCredit.order.client.id }, data: { bankDossierStatus: "VALIDE" } }),
  ]);

  await notifyAdmins(
    "Dossier de credit approuve",
    `La banque a approuve le dossier de credit pour la commande ${bankCredit.order.id}.`,
    { bankCreditId: bankCredit.id, orderId: bankCredit.order.id }
  );

  await recordAudit({
    userId: bankId,
    action: "BANK_CREDIT_APPROVED",
    entityType: "bank_credit",
    entityId: bankCredit.id,
  });

  await notifyUser(
    bankCredit.order.client.userId,
    "Dossier de credit approuve",
    "Votre demande de credit bancaire a ete approuvee par la banque, en attente du virement vers NanaPay."
  );

  return { id: bankCredit.id, status: "APPROUVE" as const };
}

export async function rejectCreditRequest(bankId: string, bankCreditId: string, reason?: string) {
  const bankCredit = await getOwnBankCreditOrThrow(bankId, bankCreditId);

  if (bankCredit.approvalStatus !== "EN_ATTENTE") {
    throw AppError.conflict(`Ce dossier a deja ete traite (statut: ${bankCredit.approvalStatus})`);
  }

  await prisma.$transaction([
    prisma.bankCredit.update({ where: { id: bankCredit.id }, data: { approvalStatus: "REJETTE" } }),
    prisma.order.update({ where: { id: bankCredit.orderId }, data: { status: "ANNULE" } }),
  ]);

  await notifyAdmins(
    "Dossier de credit rejete",
    `La banque a rejete le dossier de credit pour la commande ${bankCredit.order.id}.`,
    { bankCreditId: bankCredit.id, orderId: bankCredit.order.id, reason }
  );

  await recordAudit({
    userId: bankId,
    action: "BANK_CREDIT_REJECTED",
    entityType: "bank_credit",
    entityId: bankCredit.id,
    metadata: { reason },
  });

  await notifyUser(
    bankCredit.order.client.userId,
    "Dossier de credit rejete",
    reason ? `Votre demande de credit a ete rejetee : ${reason}` : "Votre demande de credit a ete rejetee."
  );

  return { id: bankCredit.id, status: "REJETTE" as const };
}

export async function executeTransfer(bankId: string, bankCreditId: string) {
  const bankCredit = await getOwnBankCreditOrThrow(bankId, bankCreditId);

  if (bankCredit.approvalStatus !== "APPROUVE") {
    throw AppError.conflict("Le dossier doit d'abord etre approuve avant tout virement");
  }

  if (bankCredit.transferStatus !== "NON_EFFECTUE") {
    throw AppError.conflict(`Virement deja traite (statut: ${bankCredit.transferStatus})`);
  }

  const qrCodeToken = generateQrToken();

  await prisma.$transaction([
    prisma.bankCredit.update({
      where: { id: bankCredit.id },
      data: { transferStatus: "VIREMENT_BANQUE_EFFECTUE" },
    }),
    // Credit Bancaire approuve + virement recu => financement valide (cf. cahier, section 11).
    prisma.order.update({
      where: { id: bankCredit.orderId },
      data: { status: "PRET_A_LIVRER", qrCodeToken },
    }),
  ]);

  const merchant = bankCredit.order.product.shop.merchant;

  await notifyAdmins(
    "Virement Banque -> NanaPay recu",
    `Virement de ${bankCredit.totalAmountToWire} FCFA recu pour le client ${bankCredit.order.client.firstName} ${bankCredit.order.client.lastName}, commercant ${merchant.firstName} ${merchant.lastName}.`,
    {
      bankCreditId: bankCredit.id,
      orderId: bankCredit.orderId,
      amount: bankCredit.totalAmountToWire,
      corisMoneyNumber: merchant.corisMoneyNumber,
    }
  );

  await recordAudit({
    userId: bankId,
    action: "BANK_TRANSFER_EXECUTED",
    entityType: "bank_credit",
    entityId: bankCredit.id,
    metadata: { amount: bankCredit.totalAmountToWire },
  });

  await notifyUser(
    bankCredit.order.client.userId,
    "Financement valide",
    "Le virement de la banque a ete recu, votre code QR est disponible pour le retrait en boutique."
  );

  return { id: bankCredit.id, transferStatus: "VIREMENT_BANQUE_EFFECTUE" as const };
}
