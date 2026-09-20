const tx = {
  order: { findUnique: jest.fn() },
  payment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  paymentEvent: { create: jest.fn() },
  savings: { findUniqueOrThrow: jest.fn() },
  vault: { findUniqueOrThrow: jest.fn() },
  $queryRaw: jest.fn(),
};

const prismaMock = {
  paymentEvent: { findUnique: jest.fn() },
  $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
};

jest.mock("@config/prisma", () => ({ prisma: prismaMock, INTERACTIVE_TRANSACTION_OPTIONS: {} }));
jest.mock("@services/audit/auditService", () => ({ recordAudit: jest.fn() }));
jest.mock("@services/notification/notificationService", () => ({ notifyUser: jest.fn() }));
jest.mock("@modules/savings/savings.service", () => ({ applySavingsDeposit: jest.fn() }));
jest.mock("@modules/vaults/vault.service", () => ({ applyVaultDebit: jest.fn() }));

import { Prisma } from "@prisma/client";
import { applySavingsDeposit } from "@modules/savings/savings.service";
import { PaymentWebhookPayload, processPaymentWebhook } from "@modules/payments/payment.service";

const payload = (overrides: Partial<PaymentWebhookPayload> = {}): PaymentWebhookPayload => ({
  providerTransactionId: "TX-1001",
  orderId: "order-1",
  amount: 2_000,
  currency: "XOF",
  status: "SUCCESS",
  payerReference: "70000000",
  timestamp: "2026-01-10T10:00:00.000Z",
  ...overrides,
});

const savingsOrder = {
  id: "order-1",
  status: "FINANCEMENT_EN_COURS",
  financingMode: "SAVINGS",
  cancelledAt: null,
  client: { userId: "user-1" },
  savings: { id: "sav-1" },
  vault: null,
};

const activeSavings = { id: "sav-1", status: "EN_COURS", dueDate: null, targetAmount: 10_000, savedAmount: 0, minInstallment: 1_000 };

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.paymentEvent.findUnique.mockResolvedValue(null);
  tx.order.findUnique.mockResolvedValue(savingsOrder);
  tx.payment.findUnique.mockResolvedValue(null);
  tx.savings.findUniqueOrThrow.mockResolvedValue(activeSavings);
  (applySavingsDeposit as jest.Mock).mockResolvedValue({ reached: false, isFirstDeposit: true });
});

describe("processPaymentWebhook", () => {
  it("applique un versement valide et enregistre l'evenement", async () => {
    const outcome = await processPaymentWebhook(payload());

    expect(outcome).toMatchObject({ duplicate: false, result: "APPLIED" });
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerTransactionId: "TX-1001", status: "CONFIRME", amount: 2_000 }) })
    );
    expect(applySavingsDeposit).toHaveBeenCalledWith(tx, "sav-1", 2_000, new Date("2026-01-10T10:00:00.000Z"));
    expect(tx.paymentEvent.create).toHaveBeenCalledTimes(1);
  });

  it("idempotence : un evenement deja traite n'est jamais comptabilise deux fois", async () => {
    prismaMock.paymentEvent.findUnique.mockResolvedValue({ result: "APPLIED", reason: null });

    const outcome = await processPaymentWebhook(payload());

    expect(outcome).toMatchObject({ duplicate: true, result: "APPLIED" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(applySavingsDeposit).not.toHaveBeenCalled();
  });

  it("idempotence : deux livraisons simultanees tranchees par la contrainte UNIQUE (P2002)", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" })
    );

    await expect(processPaymentWebhook(payload())).resolves.toMatchObject({ duplicate: true });
  });

  it("rejette une devise autre que XOF sans effet metier", async () => {
    const outcome = await processPaymentWebhook(payload({ currency: "EUR" }));

    expect(outcome).toMatchObject({ result: "REJECTED" });
    expect(applySavingsDeposit).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("rejette une commande inconnue", async () => {
    tx.order.findUnique.mockResolvedValue(null);
    expect(await processPaymentWebhook(payload())).toMatchObject({ result: "REJECTED", reason: "Commande inconnue" });
  });

  it("rejette un versement sous le minimum du palier", async () => {
    const outcome = await processPaymentWebhook(payload({ amount: 500 }));

    expect(outcome).toMatchObject({ result: "REJECTED" });
    expect(applySavingsDeposit).not.toHaveBeenCalled();
  });

  it("rejette un versement qui depasse le reste a epargner", async () => {
    tx.savings.findUniqueOrThrow.mockResolvedValue({ ...activeSavings, savedAmount: 9_000 });
    expect(await processPaymentWebhook(payload({ amount: 2_000 }))).toMatchObject({ result: "REJECTED" });
  });

  it("rejette un versement sur une commande annulee ou deja financee", async () => {
    tx.order.findUnique.mockResolvedValue({ ...savingsOrder, status: "PRETE_A_LIVRER" });
    expect(await processPaymentWebhook(payload())).toMatchObject({ result: "REJECTED" });

    tx.order.findUnique.mockResolvedValue({ ...savingsOrder, cancelledAt: new Date() });
    expect(await processPaymentWebhook(payload())).toMatchObject({ result: "REJECTED" });
  });

  it("rejette un versement apres l'echeance de l'epargne", async () => {
    tx.savings.findUniqueOrThrow.mockResolvedValue({ ...activeSavings, dueDate: new Date("2025-12-31T00:00:00Z") });
    expect(await processPaymentWebhook(payload())).toMatchObject({ result: "REJECTED" });
  });

  it("PENDING n'a aucun effet metier et ne consomme pas l'identifiant de transaction", async () => {
    const outcome = await processPaymentWebhook(payload({ status: "PENDING" }));

    expect(outcome).toMatchObject({ result: "IGNORED" });
    expect(applySavingsDeposit).not.toHaveBeenCalled();
    expect(tx.paymentEvent.create).not.toHaveBeenCalled();
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "EN_ATTENTE" }) }));
  });

  it("un SUCCESS apres un PENDING de la meme transaction confirme la ligne existante", async () => {
    tx.payment.findUnique.mockResolvedValue({ id: "pay-1", status: "EN_ATTENTE" });

    const outcome = await processPaymentWebhook(payload());

    expect(outcome).toMatchObject({ result: "APPLIED" });
    expect(tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pay-1" } }));
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(applySavingsDeposit).toHaveBeenCalledTimes(1);
  });

  it("une transaction deja CONFIRME n'est pas reappliquee", async () => {
    tx.payment.findUnique.mockResolvedValue({ id: "pay-1", status: "CONFIRME" });

    expect(await processPaymentWebhook(payload())).toMatchObject({ duplicate: true });
    expect(applySavingsDeposit).not.toHaveBeenCalled();
  });

  it("une transaction marquee ECHOUE ne peut pas etre creditee ensuite", async () => {
    tx.payment.findUnique.mockResolvedValue({ id: "pay-1", status: "ECHOUE" });

    expect(await processPaymentWebhook(payload())).toMatchObject({ result: "REJECTED" });
    expect(applySavingsDeposit).not.toHaveBeenCalled();
  });

  it("verrouille la ligne d'epargne avant de valider le montant", async () => {
    await processPaymentWebhook(payload());
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});
