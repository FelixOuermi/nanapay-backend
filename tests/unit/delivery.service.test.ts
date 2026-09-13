jest.mock("@config/prisma", () => {
  const mockedPrisma: Record<string, unknown> = {
    order: { findUnique: jest.fn(), update: jest.fn() },
    orderDelivery: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => unknown)(mockedPrisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
  return { prisma: mockedPrisma };
});

jest.mock("@services/audit/auditService", () => ({ recordAudit: jest.fn() }));

jest.mock("@modules/payouts/payout.service", () => ({
  createMerchantPayoutForOrder: jest.fn(() => Promise.resolve({ id: "payout-1" })),
}));

jest.mock("@services/notification/notificationService", () => ({ notifyUser: jest.fn() }));

import { prisma } from "@config/prisma";
import { createMerchantPayoutForOrder } from "@modules/payouts/payout.service";
import * as deliveryService from "@modules/deliveries/delivery.service";

const mockedPrisma = prisma as unknown as {
  order: { findUnique: jest.Mock; update: jest.Mock };
  orderDelivery: { create: jest.Mock };
};

const MERCHANT_ID = "merchant-1";
const REAL_TOKEN = "a".repeat(64);

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    status: "PRET_A_LIVRER",
    qrCodeToken: REAL_TOKEN,
    paymentMode: "EPARGNE",
    product: { shop: { merchantId: MERCHANT_ID } },
    savingsPlan: null,
    client: { userId: "user-1" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("delivery.service - scanQrCode", () => {
  it("refuse un commercant non proprietaire (404, pas 403)", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(
      makeOrder({ product: { shop: { merchantId: "un-autre-commercant" } } })
    );

    await expect(deliveryService.scanQrCode(MERCHANT_ID, "order-1", REAL_TOKEN)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("refuse un double scan", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(makeOrder({ status: "LIVRE" }));

    await expect(deliveryService.scanQrCode(MERCHANT_ID, "order-1", REAL_TOKEN)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("refuse une commande qui n'est pas encore prete", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(makeOrder({ status: "EN_COURS", qrCodeToken: null }));

    await expect(deliveryService.scanQrCode(MERCHANT_ID, "order-1", REAL_TOKEN)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("refuse un code QR invalide", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(makeOrder());

    await expect(deliveryService.scanQrCode(MERCHANT_ID, "order-1", "b".repeat(64))).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(mockedPrisma.orderDelivery.create).not.toHaveBeenCalled();
  });

  it("valide le retrait Epargne, passe la commande a LIVRE et declenche le reversement", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(makeOrder());
    mockedPrisma.order.update.mockResolvedValueOnce({ id: "order-1", status: "LIVRE" });

    const result = await deliveryService.scanQrCode(MERCHANT_ID, "order-1", REAL_TOKEN);

    expect(mockedPrisma.orderDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: "order-1", scannedByMerchantId: MERCHANT_ID }),
      })
    );
    expect(mockedPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "LIVRE" } })
    );
    expect(createMerchantPayoutForOrder).toHaveBeenCalled();
    expect(result).toEqual({ order: { id: "order-1", status: "LIVRE" }, payout: { id: "payout-1" } });
  });

  it("valide le retrait Credit Bancaire sans declencher de reversement (gere par l'Admin)", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(makeOrder({ paymentMode: "CREDIT_BANCAIRE" }));
    mockedPrisma.order.update.mockResolvedValueOnce({ id: "order-1", status: "LIVRE" });

    const result = await deliveryService.scanQrCode(MERCHANT_ID, "order-1", REAL_TOKEN);

    expect(createMerchantPayoutForOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ order: { id: "order-1", status: "LIVRE" }, payout: null });
  });
});
