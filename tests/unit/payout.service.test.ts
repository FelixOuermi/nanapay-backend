jest.mock("@config/prisma", () => ({
  prisma: { merchantPayout: { findMany: jest.fn() } },
}));

jest.mock("@services/audit/auditService", () => ({ recordAudit: jest.fn() }));
jest.mock("@config/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { prisma } from "@config/prisma";
import * as payoutService from "@modules/payouts/payout.service";

const mockedPrisma = prisma as unknown as { merchantPayout: { findMany: jest.Mock } };

function makeFakeTx(merchant: Record<string, unknown> | null) {
  return {
    merchant: { findUnique: jest.fn().mockResolvedValue(merchant) },
    merchantPayout: { create: jest.fn((args: { data: unknown }) => Promise.resolve({ id: "payout-1", ...args.data as object })) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("payout.service - createMerchantPayoutForOrder (Epargne)", () => {
  it("calcule le reversement avec le taux HT degressif et le canal Mobile Money par defaut du commercant", async () => {
    const tx = makeFakeTx({ id: "merchant-1", defaultPayoutAccount: "ORANGE_MONEY" });
    const order = {
      id: "order-1",
      paymentMode: "EPARGNE" as const,
      totalAmount: 30_000,
      savingsPlan: { currentSavedAmount: 30_000 },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payout = await payoutService.createMerchantPayoutForOrder(tx as any, order as any, "merchant-1");

    expect(tx.merchantPayout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossAmount: 30_000,
          commissionAmount: 2_400, // 8% de 30 000
          netAmountPaid: 27_600,
          payoutChannel: "ORANGE_MONEY",
        }),
      })
    );
    expect(payout.id).toBe("payout-1");
  });

  it("rejette si la commande Epargne n'a pas de plan associe", async () => {
    const tx = makeFakeTx({ id: "merchant-1", defaultPayoutAccount: "ORANGE_MONEY" });
    const order = { id: "order-1", paymentMode: "EPARGNE" as const, totalAmount: 30_000, savingsPlan: null };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payoutService.createMerchantPayoutForOrder(tx as any, order as any, "merchant-1")
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe("payout.service - createMerchantPayoutForOrder (Credit Bancaire)", () => {
  it("calcule le reversement avec la commission de 4% et le canal Coris Money, conformement a l'exemple du document", async () => {
    const tx = makeFakeTx({ id: "merchant-1", defaultPayoutAccount: "ORANGE_MONEY", corisMoneyNumber: "7000" });
    const order = {
      id: "order-1",
      paymentMode: "CREDIT_BANCAIRE" as const,
      totalAmount: 50_000,
      savingsPlan: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await payoutService.createMerchantPayoutForOrder(tx as any, order as any, "merchant-1");

    expect(tx.merchantPayout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossAmount: 50_000,
          commissionAmount: 2_000,
          netAmountPaid: 48_000,
          payoutChannel: "CORIS_MONEY",
        }),
      })
    );
  });
});

describe("payout.service - listMerchantPayouts", () => {
  it("liste les reversements d'un commercant, les plus recents en premier", async () => {
    mockedPrisma.merchantPayout.findMany.mockResolvedValueOnce([]);

    await payoutService.listMerchantPayouts("merchant-1");

    expect(mockedPrisma.merchantPayout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: "merchant-1" }, orderBy: { payoutDate: "desc" } })
    );
  });
});
