jest.mock("@config/prisma", () => {
  const mockedPrisma: Record<string, unknown> = {
    product: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    order: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    savingsPlan: { update: jest.fn() },
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

jest.mock("@modules/savings/savings.service", () => ({
  checkAndApplyOverduePenalty: jest.fn(),
}));

import { prisma } from "@config/prisma";
import { checkAndApplyOverduePenalty } from "@modules/savings/savings.service";
import * as orderService from "@modules/orders/order.service";

const mockedPrisma = prisma as unknown as {
  product: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
  order: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  savingsPlan: { update: jest.Mock };
};

const CLIENT_ID = "client-1";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("order.service - createOrder", () => {
  it("refuse un article introuvable", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce(null);

    await expect(
      orderService.createOrder(CLIENT_ID, { productId: "product-x", paymentMode: "EPARGNE" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuse un article epuise ou invisible", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      price: 30_000,
      remainingStock: 0,
      isVisible: true,
    });

    await expect(
      orderService.createOrder(CLIENT_ID, { productId: "product-1", paymentMode: "EPARGNE" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuse si le decrement conditionnel echoue (vente concurrente)", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      price: 30_000,
      remainingStock: 1,
      isVisible: true,
    });
    mockedPrisma.product.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      orderService.createOrder(CLIENT_ID, { productId: "product-1", paymentMode: "EPARGNE" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("cree une commande Epargne avec les modalites du palier 0-50 000 FCFA et jamais le prix du client", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      price: 30_000,
      remainingStock: 5,
      isVisible: true,
    });
    mockedPrisma.product.updateMany.mockResolvedValueOnce({ count: 1 });
    mockedPrisma.order.create.mockResolvedValueOnce({ id: "order-1" });

    await orderService.createOrder(CLIENT_ID, { productId: "product-1", paymentMode: "EPARGNE" });

    const createArgs = mockedPrisma.order.create.mock.calls[0][0];
    expect(createArgs.data.totalAmount).toBe(30_000);
    expect(createArgs.data.maxDurationMonths).toBe(8);
    expect(createArgs.data.savingsPlan.create.minInstallmentAmount).toBe(1_000);
  });

  it("masque l'article quand le stock restant tombe a zero apres l'achat", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      price: 30_000,
      remainingStock: 1,
      isVisible: true,
    });
    mockedPrisma.product.updateMany.mockResolvedValueOnce({ count: 1 });
    mockedPrisma.order.create.mockResolvedValueOnce({ id: "order-1" });

    await orderService.createOrder(CLIENT_ID, { productId: "product-1", paymentMode: "EPARGNE" });

    expect(mockedPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isVisible: false } })
    );
  });

  it("cree une commande Credit Bancaire avec la duree maximale calculee (pas de savingsPlan)", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      price: 120_000,
      remainingStock: 5,
      isVisible: true,
      shop: { merchant: { corisMoneyNumber: "70000000" } },
    });
    mockedPrisma.product.updateMany.mockResolvedValueOnce({ count: 1 });
    mockedPrisma.order.create.mockResolvedValueOnce({ id: "order-1" });

    await orderService.createOrder(CLIENT_ID, { productId: "product-1", paymentMode: "CREDIT_BANCAIRE" });

    const createArgs = mockedPrisma.order.create.mock.calls[0][0];
    expect(createArgs.data.maxDurationMonths).toBe(18);
    expect(createArgs.data.savingsPlan).toBeUndefined();
  });

  it("refuse le Credit Bancaire si le commercant n'a pas de numero Coris Money", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      price: 120_000,
      remainingStock: 5,
      isVisible: true,
      shop: { merchant: { corisMoneyNumber: null } },
    });

    await expect(
      orderService.createOrder(CLIENT_ID, { productId: "product-1", paymentMode: "CREDIT_BANCAIRE" })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockedPrisma.product.updateMany).not.toHaveBeenCalled();
  });
});

describe("order.service - getOrderDetail", () => {
  it("rejette une commande qui n'appartient pas au client (404, pas 403)", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({ id: "order-1", clientId: "un-autre-client" });

    await expect(orderService.getOrderDetail(CLIENT_ID, "order-1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("verifie la penalite de retard quand un savingsPlan existe", async () => {
    const orderData = { id: "order-1", clientId: CLIENT_ID, savingsPlan: { id: "sp-1" } };
    mockedPrisma.order.findUnique.mockResolvedValue(orderData);

    await orderService.getOrderDetail(CLIENT_ID, "order-1");

    expect(checkAndApplyOverduePenalty).toHaveBeenCalledWith(orderData.savingsPlan, orderData);
  });
});

describe("order.service - extendSavingsDeadline", () => {
  const baseOrder = {
    id: "order-1",
    clientId: CLIENT_ID,
    paymentMode: "EPARGNE" as const,
    extendedMonths: 0,
    savingsPlan: {
      id: "sp-1",
      isCompleted: false,
      dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    },
  };

  it("refuse une extension sur une commande Credit Bancaire", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({ ...baseOrder, paymentMode: "CREDIT_BANCAIRE" });

    await expect(orderService.extendSavingsDeadline(CLIENT_ID, "order-1", 1)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuse une extension au-dela du plafond de 2 mois", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      ...baseOrder,
      extendedMonths: 1,
    });

    await expect(orderService.extendSavingsDeadline(CLIENT_ID, "order-1", 2)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuse une extension demandee apres l'echeance", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      ...baseOrder,
      savingsPlan: { ...baseOrder.savingsPlan, dueDate: new Date(Date.now() - 1000) },
    });

    await expect(orderService.extendSavingsDeadline(CLIENT_ID, "order-1", 1)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("accorde une extension valide et met a jour l'echeance", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue(baseOrder);
    mockedPrisma.order.update.mockResolvedValueOnce({ extendedMonths: 1 });
    mockedPrisma.savingsPlan.update.mockResolvedValueOnce({});

    await orderService.extendSavingsDeadline(CLIENT_ID, "order-1", 1);

    expect(mockedPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { extendedMonths: { increment: 1 } } })
    );
  });
});

describe("order.service - getOrderQrCode", () => {
  it("refuse tant que le financement n'est pas valide", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      clientId: CLIENT_ID,
      status: "EN_COURS",
      qrCodeToken: null,
    });

    await expect(orderService.getOrderQrCode(CLIENT_ID, "order-1")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("renvoie le token QR une fois PRET_A_LIVRER", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      clientId: CLIENT_ID,
      status: "PRET_A_LIVRER",
      qrCodeToken: "abc123",
    });

    const result = await orderService.getOrderQrCode(CLIENT_ID, "order-1");

    expect(result).toEqual({ orderId: "order-1", qrCodeToken: "abc123" });
  });
});
