import { Prisma, WebhookEventResult } from "@prisma/client";
import { z } from "zod";
import { prisma, INTERACTIVE_TRANSACTION_OPTIONS } from "@config/prisma";
import { recordAudit } from "@services/audit/auditService";
import { notifyUser } from "@services/notification/notificationService";
import { validateSavingsDeposit } from "@services/financial/financialService";
import { applySavingsDeposit } from "@modules/savings/savings.service";
import { applyVaultDebit } from "@modules/vaults/vault.service";

// Contrat webhook (cahier, section 5) :
// POST /api/webhooks/payment  Header X-Signature  Body { providerTransactionId, orderId,
// amount, currency, status, payerReference, timestamp }
export const paymentWebhookSchema = z.object({
  providerTransactionId: z.string().min(3).max(200),
  orderId: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().min(3).max(3),
  status: z.enum(["SUCCESS", "FAILED", "PENDING"]),
  payerReference: z.string().max(200).optional(),
  timestamp: z.string().datetime({ offset: true }),
  provider: z.string().max(50).optional(),
});

export type PaymentWebhookPayload = z.infer<typeof paymentWebhookSchema>;

export const ACCEPTED_CURRENCY = "XOF";

export interface WebhookOutcome {
  received: true;
  duplicate: boolean;
  result: WebhookEventResult;
  reason?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Traite un evenement de paiement Mobile Money DEJA authentifie (signature verifiee en
 * amont). Garanties :
 *  - une meme providerTransactionId n'est JAMAIS comptabilisee deux fois (contrainte UNIQUE
 *    sur payment_events ET payments, plus verification prealable) ;
 *  - signature, montant, commande, devise et statut sont verifies AVANT toute ecriture metier ;
 *  - verrou de ligne (SELECT ... FOR UPDATE) sur l'epargne/le coffre : deux paiements
 *    concurrents ne peuvent pas depasser l'objectif ;
 *  - un evenement metier invalide est enregistre (REJECTED) sans effet et renvoye en 200
 *    pour que l'operateur ne le rejoue pas indefiniment.
 */
export async function processPaymentWebhook(payload: PaymentWebhookPayload): Promise<WebhookOutcome> {
  const existing = await prisma.paymentEvent.findUnique({
    where: { providerTransactionId: payload.providerTransactionId },
  });
  if (existing) {
    return { received: true, duplicate: true, result: existing.result, reason: existing.reason ?? undefined };
  }

  let outcome: WebhookOutcome;
  try {
    outcome = await prisma.$transaction(
      async (tx) => applyEvent(tx, payload),
      INTERACTIVE_TRANSACTION_OPTIONS
    );
  } catch (error) {
    // Deux livraisons strictement simultanees du meme evenement : la contrainte UNIQUE
    // tranche au niveau DB, l'autre livraison est traitee comme un rejeu.
    if (isUniqueViolation(error)) {
      return { received: true, duplicate: true, result: "APPLIED" };
    }
    throw error;
  }

  return outcome;
}

async function record(
  tx: Prisma.TransactionClient,
  payload: PaymentWebhookPayload,
  result: WebhookEventResult,
  reason?: string
): Promise<WebhookOutcome> {
  await tx.paymentEvent.create({
    data: {
      providerTransactionId: payload.providerTransactionId,
      orderId: payload.orderId,
      amount: payload.amount,
      currency: payload.currency,
      status: payload.status,
      payload: payload as unknown as Prisma.InputJsonValue,
      result,
      reason,
    },
  });
  return { received: true, duplicate: false, result, reason };
}

type ConfirmedPaymentData = Omit<Prisma.PaymentUncheckedCreateInput, "status">;

/** Confirme la ligne EN_ATTENTE de cette transaction si elle existe, sinon la cree. */
async function confirmPayment(
  tx: Prisma.TransactionClient,
  priorId: string | undefined,
  data: ConfirmedPaymentData
) {
  const confirmed = { ...data, status: "CONFIRME" as const, confirmedAt: data.confirmedAt ?? new Date() };
  if (priorId) {
    await tx.payment.update({ where: { id: priorId }, data: confirmed });
  } else {
    await tx.payment.create({ data: confirmed });
  }
}

async function applyEvent(
  tx: Prisma.TransactionClient,
  payload: PaymentWebhookPayload
): Promise<WebhookOutcome> {
  if (payload.currency !== ACCEPTED_CURRENCY) {
    return record(tx, payload, "REJECTED", `Devise non supportee : ${payload.currency}`);
  }

  const order = await tx.order.findUnique({
    where: { id: payload.orderId },
    include: { savings: true, vault: true, client: { select: { userId: true } } },
  });
  if (!order) {
    return record(tx, payload, "REJECTED", "Commande inconnue");
  }

  const provider = payload.provider ?? "MOBILE_MONEY";

  const prior = await tx.payment.findUnique({
    where: { providerTransactionId: payload.providerTransactionId },
  });
  if (prior?.status === "CONFIRME") {
    return { received: true, duplicate: true, result: "APPLIED" };
  }

  if (payload.status !== "SUCCESS") {
    // Un paiement echoue ou en attente n'a aucun effet metier. On garde sa trace SANS
    // consommer l'identifiant : les operateurs envoient couramment PENDING puis SUCCESS
    // pour la meme transaction, et ce SUCCESS doit encore pouvoir etre applique.
    const state = payload.status === "FAILED" ? "ECHOUE" : "EN_ATTENTE";
    if (prior) {
      if (prior.status !== "ECHOUE") {
        await tx.payment.update({ where: { id: prior.id }, data: { status: state } });
      }
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          savingsId: order.savings?.id,
          vaultId: order.vault?.id,
          kind: order.financingMode === "VAULT" ? "VAULT_DEBIT" : "SAVINGS_DEPOSIT",
          amount: payload.amount,
          currency: payload.currency,
          provider,
          providerTransactionId: payload.providerTransactionId,
          payerReference: payload.payerReference,
          status: state,
        },
      });
    }
    return {
      received: true,
      duplicate: false,
      result: "IGNORED",
      reason: `Statut operateur : ${payload.status}`,
    };
  }

  if (prior?.status === "ECHOUE") {
    return record(tx, payload, "REJECTED", "Transaction deja marquee echouee par l'operateur");
  }

  if (order.cancelledAt || order.status !== "FINANCEMENT_EN_COURS") {
    return record(tx, payload, "REJECTED", `Commande non eligible aux versements (statut : ${order.status})`);
  }

  const paymentAt = new Date(payload.timestamp);

  if (order.financingMode === "SAVINGS" && order.savings) {
    // Verrou de ligne puis relecture : la validation du montant se fait sur l'etat verrouille.
    await tx.$queryRaw`SELECT id FROM savings WHERE id = ${order.savings.id} FOR UPDATE`;
    const savings = await tx.savings.findUniqueOrThrow({ where: { id: order.savings.id } });

    if (savings.status !== "EN_COURS" && savings.status !== "PROLONGATION") {
      return record(tx, payload, "REJECTED", `Epargne non active (statut : ${savings.status})`);
    }
    if (savings.dueDate && paymentAt > savings.dueDate) {
      return record(tx, payload, "REJECTED", "Versement apres l'echeance de l'epargne");
    }

    const check = validateSavingsDeposit(
      payload.amount,
      savings.targetAmount - savings.savedAmount,
      savings.minInstallment
    );
    if (!check.valid) {
      return record(tx, payload, "REJECTED", check.reason);
    }

    await confirmPayment(tx, prior?.id, {
      orderId: order.id,
      savingsId: savings.id,
      kind: "SAVINGS_DEPOSIT",
      amount: payload.amount,
      currency: payload.currency,
      provider,
      providerTransactionId: payload.providerTransactionId,
      payerReference: payload.payerReference,
      confirmedAt: new Date(),
    });

    const { reached, isFirstDeposit } = await applySavingsDeposit(tx, savings.id, payload.amount, paymentAt);

    await recordAudit(
      {
        actorRole: "SYSTEM",
        action: reached ? "SAVINGS_TARGET_REACHED" : "SAVINGS_DEPOSIT_CONFIRMED",
        entityType: "savings",
        entityId: savings.id,
        amount: payload.amount,
        status: reached ? "ATTEINTE" : savings.status,
        metadata: { providerTransactionId: payload.providerTransactionId, firstDeposit: isFirstDeposit },
      },
      tx
    );

    await notifyUser(
      order.client.userId,
      reached ? "Objectif d'epargne atteint" : "Versement recu",
      reached
        ? "Votre epargne est a 100 % : votre commande est prete, votre code QR est disponible."
        : `Versement de ${payload.amount} FCFA recu.`,
      { orderId: order.id, savingsId: savings.id },
      tx
    );

    return record(tx, payload, "APPLIED");
  }

  if (order.financingMode === "VAULT" && order.vault) {
    await tx.$queryRaw`SELECT id FROM vaults WHERE id = ${order.vault.id} FOR UPDATE`;
    const vault = await tx.vault.findUniqueOrThrow({ where: { id: order.vault.id } });

    if (vault.status !== "PROGRAMME" && vault.status !== "PRELEVEMENT_EN_COURS") {
      return record(tx, payload, "REJECTED", `Coffre non actif (statut : ${vault.status})`);
    }
    if (payload.amount > vault.targetAmount - vault.collectedAmount) {
      return record(tx, payload, "REJECTED", "Montant superieur au reste a prelever");
    }

    await confirmPayment(tx, prior?.id, {
      orderId: order.id,
      vaultId: vault.id,
      kind: "VAULT_DEBIT",
      amount: payload.amount,
      currency: payload.currency,
      provider,
      providerTransactionId: payload.providerTransactionId,
      payerReference: payload.payerReference,
      confirmedAt: new Date(),
    });

    const { reached } = await applyVaultDebit(tx, vault.id, payload.amount);

    await recordAudit(
      {
        actorRole: "SYSTEM",
        action: reached ? "VAULT_TARGET_REACHED" : "VAULT_DEBIT_CONFIRMED",
        entityType: "vault",
        entityId: vault.id,
        amount: payload.amount,
        status: reached ? "OBJECTIF_ATTEINT" : "PRELEVEMENT_EN_COURS",
        metadata: { providerTransactionId: payload.providerTransactionId },
      },
      tx
    );

    await notifyUser(
      order.client.userId,
      reached ? "Coffre complet" : "Prelevement recu",
      reached
        ? "Votre Coffre est complet : utilisez-le pour obtenir votre code QR."
        : `Prelevement de ${payload.amount} FCFA recu.`,
      { orderId: order.id, vaultId: vault.id },
      tx
    );

    return record(tx, payload, "APPLIED");
  }

  return record(tx, payload, "REJECTED", "Cette commande n'a pas de plan d'epargne ou de coffre actif");
}
