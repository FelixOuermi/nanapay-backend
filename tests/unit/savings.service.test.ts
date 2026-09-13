jest.mock("@config/prisma", () => {
  const mockedPrisma: Record<string, unknown> = {
    order: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    client: { findUnique: jest.fn() },
    user: { update: jest.fn() },
    savingsPlan: { update: jest.fn() },
    savingsDeposit: { findUnique: jest.fn(), create: jest.fn() },
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
jest.mock("@config/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("@services/qr/qrService", () => ({ generateQrToken: jest.fn(() => "fixed-qr-token") }));
jest.mock("@services/notification/notificationService", () => ({ notifyUser: jest.fn() }));

import { Order, Prisma, SavingsPlan } from "@prisma/client";
import { prisma } from "@config/prisma";
import * as savingsService from "@modules/savings/savings.service";

function fakeSavingsPlan(overrides: Partial<SavingsPlan>): SavingsPlan {
  return overrides as SavingsPlan;
}

function fakeOrder(overrides: Partial<Order>): Order {
  return overrides as Order;
}

const mockedPrisma = prisma as unknown as {
  order: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  client: { findUnique: jest.Mock };
  user: { update: jest.Mock };
  savingsPlan: { update: jest.Mock };
  savingsDeposit: { findUnique: jest.Mock; create: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("savings.service - checkAndApplyOverduePenalty", () => {
  const overduePlan = fakeSavingsPlan({
    id: "sp-1",
    currentSavedAmount: 20_000 as unknown as SavingsPlan["currentSavedAmount"], // Decimal en prod ; number suffit en test
    isCompleted: false,
    penaltyApplied: false,
    dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  const order = fakeOrder({ id: "order-1", clientId: "client-1" });

  it("ne fait rien si le plan est deja termine", async () => {
    await savingsService.checkAndApplyOverduePenalty({ ...overduePlan, isCompleted: true }, order);

    expect(mockedPrisma.savingsPlan.update).not.toHaveBeenCalled();
  });

  it("ne fait rien si l'echeance n'est pas encore depassee", async () => {
    const futurePlan = { ...overduePlan, dueDate: new Date(Date.now() + 100_000) };

    await savingsService.checkAndApplyOverduePenalty(futurePlan, order);

    expect(mockedPrisma.savingsPlan.update).not.toHaveBeenCalled();
  });

  it("applique la regle 15%/85% et bloque le compte quand le delai est depasse", async () => {
    mockedPrisma.client.findUnique.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });

    await savingsService.checkAndApplyOverduePenalty(overduePlan, order);

    expect(mockedPrisma.savingsPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { penaltyApplied: true } })
    );
    expect(mockedPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ECHEC_PENALISE" } })
    );
    expect(mockedPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" }, data: { isActive: false } })
    );
  });
});

describe("savings.service - processSavingsDeposit", () => {
  it("refuse une commande qui n'est pas une Epargne", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({ id: "order-1", paymentMode: "CREDIT_BANCAIRE" });

    await expect(
      savingsService.processSavingsDeposit({
        orderId: "order-1",
        transactionReference: "tx-1",
        amount: 5_000,
        operator: "ORANGE_MONEY",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("est idempotent sur un evenement webhook duplique (meme transactionReference)", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      paymentMode: "EPARGNE",
      status: "EN_COURS",
      savingsPlan: { id: "sp-1", currentSavedAmount: 5_000, targetAmount: 30_000, isCompleted: false },
    });
    mockedPrisma.savingsDeposit.findUnique.mockResolvedValueOnce({ id: "deposit-existant" });

    const result = await savingsService.processSavingsDeposit({
      orderId: "order-1",
      transactionReference: "tx-deja-traite",
      amount: 5_000,
      operator: "ORANGE_MONEY",
    });

    expect(result).toEqual({ alreadyProcessed: true, orderId: "order-1" });
    expect(mockedPrisma.savingsDeposit.create).not.toHaveBeenCalled();
  });

  it("reste idempotent meme si deux webhooks identiques passent la verification en meme temps (P2002)", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      paymentMode: "EPARGNE",
      status: "EN_COURS",
      savingsPlan: { id: "sp-1", currentSavedAmount: 5_000, targetAmount: 30_000, isCompleted: false },
      client: { userId: "user-1" },
    });
    // Les deux requetes concurrentes voient "pas encore de depot" avant que l'une des deux
    // n'insere : la contrainte UNIQUE tranche au niveau DB pour la seconde (P2002).
    mockedPrisma.savingsDeposit.findUnique.mockResolvedValueOnce(null);
    mockedPrisma.savingsDeposit.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );

    const result = await savingsService.processSavingsDeposit({
      orderId: "order-1",
      transactionReference: "tx-course",
      amount: 5_000,
      operator: "ORANGE_MONEY",
    });

    expect(result).toEqual({ alreadyProcessed: true, orderId: "order-1" });
  });

  it("incremente le montant epargne sans finaliser si le total reste sous la cible", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      paymentMode: "EPARGNE",
      status: "EN_COURS",
      savingsPlan: { id: "sp-1", currentSavedAmount: 5_000, targetAmount: 30_000, isCompleted: false },
      client: { userId: "user-1" },
    });
    mockedPrisma.savingsDeposit.findUnique.mockResolvedValueOnce(null);

    const result = await savingsService.processSavingsDeposit({
      orderId: "order-1",
      transactionReference: "tx-2",
      amount: 1_000,
      operator: "ORANGE_MONEY",
    });

    expect(result).toEqual({ alreadyProcessed: false, orderId: "order-1", isCompleted: false });
    expect(mockedPrisma.savingsPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentSavedAmount: 6_000, isCompleted: false } })
    );
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
  });

  it("finalise l'Epargne, genere le QR et passe la commande a PRET_A_LIVRER a 100%", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      paymentMode: "EPARGNE",
      status: "EN_COURS",
      savingsPlan: { id: "sp-1", currentSavedAmount: 29_000, targetAmount: 30_000, isCompleted: false },
      client: { userId: "user-1" },
    });
    mockedPrisma.savingsDeposit.findUnique.mockResolvedValueOnce(null);

    const result = await savingsService.processSavingsDeposit({
      orderId: "order-1",
      transactionReference: "tx-3",
      amount: 1_000,
      operator: "CORIS_MONEY",
    });

    expect(result).toEqual({ alreadyProcessed: false, orderId: "order-1", isCompleted: true });
    expect(mockedPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PRET_A_LIVRER", qrCodeToken: "fixed-qr-token" } })
    );
  });
});
