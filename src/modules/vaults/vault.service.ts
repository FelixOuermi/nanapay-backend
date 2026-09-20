import { Prisma } from "@prisma/client";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { recordAudit } from "@services/audit/auditService";
import { notifyUser } from "@services/notification/notificationService";
import { computeCreditTerms, computeVaultTerms } from "@services/financial/financialService";
import { getFinancialParams } from "@services/financial/settingsService";
import { getOwnOrderOrThrow } from "@modules/orders/order.service";
import { markOrderFinanced, markOrderReadyForPickup } from "@modules/orders/orderWorkflow";

async function getOwnVaultOrThrow(clientId: string, vaultId: string) {
  const vault = await prisma.vault.findUnique({ where: { id: vaultId }, include: { order: true } });
  if (!vault || vault.order.clientId !== clientId) {
    throw AppError.notFound("Coffre introuvable");
  }
  return vault;
}

/**
 * POST /orders/:id/vault : programme le Coffre (prelevement automatique sur salaire).
 * Reserve aux salaries dont le profil credit bancaire est deja valide.
 */
export async function createVault(
  clientId: string,
  orderId: string,
  durationMonths: number,
  salaryDebitAuthorizationUrl?: string
) {
  const order = await getOwnOrderOrThrow(clientId, orderId);

  if (order.cancelledAt) {
    throw AppError.conflict("Cette commande est annulee");
  }
  if (order.financingMode !== "VAULT" || order.status !== "FINANCEMENT_EN_COURS") {
    throw AppError.conflict("Choisissez d'abord le financement par Coffre (POST /orders/:id/select-financing)");
  }
  if (order.vault) {
    throw AppError.conflict("Un Coffre existe deja pour cette commande");
  }

  const profile = await prisma.creditProfile.findUnique({ where: { clientId } });
  if (!profile || profile.status !== "VALIDE" || !profile.employer) {
    throw AppError.forbidden("Le Coffre est reserve aux salaries dont le profil credit bancaire est valide");
  }

  const params = await getFinancialParams();
  let terms;
  try {
    terms = computeVaultTerms(order.amount, durationMonths, params);
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : "Duree invalide");
  }

  const vault = await prisma.vault.create({
    data: {
      orderId,
      targetAmount: order.amount,
      monthlyAmount: terms.monthlyAmount,
      durationMonths,
      // A defaut de document dedie, l'autorisation de prelevement du profil credit fait foi.
      salaryDebitAuthorizationUrl: salaryDebitAuthorizationUrl ?? profile.bankAuthorizationUrl,
    },
  });

  await recordAudit({
    actorRole: "CLIENT",
    action: "VAULT_CREATED",
    entityType: "vault",
    entityId: vault.id,
    amount: vault.targetAmount,
    status: vault.status,
    metadata: { orderId, durationMonths },
  });

  return { ...vault, paymentReference: order.id };
}

export async function getVault(clientId: string, vaultId: string) {
  const vault = await getOwnVaultOrThrow(clientId, vaultId);
  const { order, ...rest } = vault;
  void order;
  return {
    ...rest,
    remainingAmount: Math.max(0, vault.targetAmount - vault.collectedAmount),
    progressPercent: Math.min(100, Math.floor((vault.collectedAmount / vault.targetAmount) * 100)),
  };
}

/**
 * Applique un prelevement valide (appele par le traitement des webhooks, dans SA
 * transaction). Premier prelevement : PRELEVEMENT_EN_COURS. Objectif atteint :
 * OBJECTIF_ATTEINT et commande FINANCEE ; le client "utilise" ensuite son Coffre pour
 * obtenir le QR (POST /vaults/:id/use).
 */
export async function applyVaultDebit(tx: Prisma.TransactionClient, vaultId: string, amount: number) {
  const vault = await tx.vault.findUniqueOrThrow({ where: { id: vaultId } });
  const collectedAmount = vault.collectedAmount + amount;
  const reached = collectedAmount >= vault.targetAmount;

  const updated = await tx.vault.update({
    where: { id: vaultId },
    data: { collectedAmount, status: reached ? "OBJECTIF_ATTEINT" : "PRELEVEMENT_EN_COURS" },
  });

  if (reached) {
    await markOrderFinanced(tx, vault.orderId);
  }
  return { vault: updated, reached };
}

/** POST /vaults/:id/use : le client utilise son Coffre complet -> commande prete + QR. */
export async function useVault(clientId: string, vaultId: string) {
  const vault = await getOwnVaultOrThrow(clientId, vaultId);
  const params = await getFinancialParams();

  if (vault.status !== "OBJECTIF_ATTEINT") {
    throw AppError.conflict(`Le Coffre ne peut pas etre utilise (statut : ${vault.status})`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const { order, qr } = await markOrderReadyForPickup(tx, vault.orderId, params.qrTtlHours, { role: "CLIENT" });
    return { order, qr };
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  return { orderId: result.order.id, status: result.order.status, qrToken: result.qr.token, expiresAt: result.qr.expiresAt };
}

/**
 * POST /vaults/:id/switch-to-credit : bascule vers un credit pour le reste a financer.
 * Exige un profil credit valide ; cree la demande de credit du montant restant.
 */
export async function switchToCredit(clientId: string, vaultId: string, durationMonths: number) {
  const vault = await getOwnVaultOrThrow(clientId, vaultId);

  if (vault.status !== "PROGRAMME" && vault.status !== "PRELEVEMENT_EN_COURS") {
    throw AppError.conflict(`Bascule impossible (statut du Coffre : ${vault.status})`);
  }

  const profile = await prisma.creditProfile.findUnique({ where: { clientId } });
  if (!profile || profile.status !== "VALIDE" || !profile.bankId) {
    throw AppError.forbidden("Un profil credit valide par la banque est requis pour basculer vers un credit");
  }

  const remaining = vault.targetAmount - vault.collectedAmount;
  if (remaining <= 0) {
    throw AppError.conflict("Le Coffre a deja atteint son objectif");
  }

  const params = await getFinancialParams();
  let terms;
  try {
    terms = computeCreditTerms(remaining, durationMonths, params);
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : "Duree de credit invalide");
  }

  const bank = await prisma.bank.findUniqueOrThrow({ where: { id: profile.bankId }, select: { userId: true } });

  const request = await prisma.$transaction(async (tx) => {
    const flipped = await tx.vault.updateMany({
      where: { id: vaultId, status: { in: ["PROGRAMME", "PRELEVEMENT_EN_COURS"] } },
      data: { status: "BASCULE_VERS_CREDIT" },
    });
    if (flipped.count === 0) {
      throw AppError.conflict("Ce Coffre a deja ete traite");
    }

    await tx.order.update({ where: { id: vault.orderId }, data: { financingMode: "CREDIT" } });

    const created = await tx.creditRequest.create({
      data: {
        orderId: vault.orderId,
        clientId,
        bankId: profile.bankId!,
        amount: remaining,
        durationMonths,
        monthlyInstallment: terms.monthlyInstallment,
        bankFeeAmount: terms.bankFeeAmount,
        totalAmountToWire: terms.totalAmountToWire,
        status: "ENVOYEE",
      },
    });

    await recordAudit(
      {
        actorRole: "CLIENT",
        action: "VAULT_SWITCHED_TO_CREDIT",
        entityType: "vault",
        entityId: vaultId,
        amount: remaining,
        status: "BASCULE_VERS_CREDIT",
        metadata: { creditRequestId: created.id, collectedAmount: vault.collectedAmount },
      },
      tx
    );
    return created;
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  await notifyUser(bank.userId, "Nouvelle demande de credit", `Demande de credit de ${remaining} FCFA (bascule depuis un Coffre).`, {
    creditRequestId: request.id,
  });

  return request;
}
