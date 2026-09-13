import { Prisma, Order, SavingsPlan } from "@prisma/client";
import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { computeSavingsPayout, computeCreditMerchantPayout } from "@services/financial/financialService";
import { recordAudit } from "@services/audit/auditService";
import { logger } from "@config/logger";

interface OrderForPayout extends Order {
  savingsPlan: SavingsPlan | null;
}

/**
 * Cree le reversement commercant (merchant_payouts) au moment de la livraison (scan QR
 * reussi). A appeler a l'interieur de la meme transaction que la creation de
 * order_deliveries et le passage de la commande a LIVRE (cf. cahier, section 11).
 *
 * Le virement Mobile Money reel (Orange Money / Coris Money) n'est pas encore automatise
 * (integration fournisseur non branchee, cf. services/payment) : le montant et le canal
 * sont calcules et journalises pour execution manuelle par l'Admin en attendant.
 */
export async function createMerchantPayoutForOrder(
  tx: Prisma.TransactionClient,
  order: OrderForPayout,
  merchantId: string
) {
  const articlePrice = Number(order.totalAmount);

  const { grossAmount, commissionRate, commissionAmount, netAmountPaid, payoutChannel } =
    order.paymentMode === "EPARGNE"
      ? (() => {
          if (!order.savingsPlan) {
            throw AppError.internal("Commande Epargne sans plan d'epargne associe");
          }
          const savedAmount = Number(order.savingsPlan.currentSavedAmount);
          const payout = computeSavingsPayout(articlePrice, savedAmount);
          return { grossAmount: savedAmount, payoutChannel: "MERCHANT_DEFAULT" as const, ...payout };
        })()
      : (() => {
          const payout = computeCreditMerchantPayout(articlePrice);
          return { grossAmount: articlePrice, payoutChannel: "CORIS_MONEY" as const, ...payout };
        })();

  const merchant = await tx.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    throw AppError.notFound("Commercant introuvable");
  }

  const resolvedChannel = payoutChannel === "MERCHANT_DEFAULT" ? merchant.defaultPayoutAccount : payoutChannel;

  const merchantPayout = await tx.merchantPayout.create({
    data: {
      orderId: order.id,
      merchantId,
      grossAmount,
      nanapayCommissionRate: commissionRate * 100, // stocke en pourcentage (ex: 8.00), cf. schema
      commissionAmount,
      netAmountPaid,
      payoutChannel: resolvedChannel,
    },
  });

  logger.warn("Reversement commercant calcule : virement Mobile Money a executer manuellement", {
    merchantPayoutId: merchantPayout.id,
    orderId: order.id,
    merchantId,
    netAmountPaid,
    payoutChannel: resolvedChannel,
  });

  await recordAudit({
    action: "MERCHANT_PAYOUT_CREATED",
    entityType: "merchant_payout",
    entityId: merchantPayout.id,
    metadata: { orderId: order.id, merchantId, netAmountPaid, payoutChannel: resolvedChannel },
  });

  return merchantPayout;
}

export async function listMerchantPayouts(merchantId: string) {
  return prisma.merchantPayout.findMany({
    where: { merchantId },
    include: { order: { include: { product: { select: { title: true } } } } },
    orderBy: { payoutDate: "desc" },
  });
}
