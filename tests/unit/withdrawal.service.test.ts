const tx = {
  qRToken: { updateMany: jest.fn() },
  withdrawal: { create: jest.fn() },
  order: { update: jest.fn() },
  vault: { updateMany: jest.fn() },
  merchantSettlement: { create: jest.fn() },
};

const prismaMock = {
  qRToken: { findUnique: jest.fn(), updateMany: jest.fn() },
  merchant: { findUniqueOrThrow: jest.fn() },
  $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
};

jest.mock("@config/prisma", () => ({ prisma: prismaMock, INTERACTIVE_TRANSACTION_OPTIONS: {} }));
jest.mock("@services/audit/auditService", () => ({ recordAudit: jest.fn() }));
jest.mock("@services/notification/notificationService", () => ({ notifyUser: jest.fn(), notifyAdmins: jest.fn() }));
jest.mock("@services/financial/settingsService", () => {
  const { DEFAULT_FINANCIAL_PARAMS } = jest.requireActual("@services/financial/financial.constants");
  return { getFinancialParams: jest.fn().mockResolvedValue(DEFAULT_FINANCIAL_PARAMS) };
});

import { confirmWithdrawal, scanQr } from "@modules/withdrawals/withdrawal.service";

const TOKEN = "a".repeat(64);
const future = () => new Date(Date.now() + 60 * 60 * 1000);

const qrFor = (overrides: Record<string, unknown> = {}, orderOverrides: Record<string, unknown> = {}) => ({
  id: "qr-1",
  orderId: "order-1",
  token: TOKEN,
  status: "GENERE",
  expiresAt: future(),
  order: {
    id: "order-1",
    orderNumber: "NP-2026-00000001",
    amount: 100_000,
    status: "PRETE_A_LIVRER",
    financingMode: "SAVINGS",
    product: { id: "p1", title: "Telephone" },
    store: { id: "s1", name: "Boutique", merchantId: "m1" },
    client: { userId: "u1", firstName: "Awa", lastName: "Traore" },
    ...orderOverrides,
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.qRToken.findUnique.mockResolvedValue(qrFor());
  prismaMock.merchant.findUniqueOrThrow.mockResolvedValue({ id: "m1", defaultPayoutChannel: "ORANGE_MONEY", orangeMoneyNumber: "70000000", corisMoneyNumber: null });
  tx.qRToken.updateMany.mockResolvedValue({ count: 1 });
  tx.withdrawal.create.mockResolvedValue({ id: "w1" });
  tx.merchantSettlement.create.mockResolvedValue({ id: "set1" });
});

describe("scanQr", () => {
  it("valide le jeton cote serveur sans modifier l'etat", async () => {
    const result = await scanQr("m1", TOKEN);

    expect(result).toMatchObject({ orderId: "order-1", amount: 100_000, client: { firstName: "Awa" } });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("jeton inconnu -> 404", async () => {
    prismaMock.qRToken.findUnique.mockResolvedValue(null);
    await expect(scanQr("m1", TOKEN)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("jeton d'une autre boutique -> meme 404 (n'en revele pas l'existence)", async () => {
    await expect(scanQr("autre-marchand", TOKEN)).rejects.toMatchObject({ statusCode: 404, message: "Code QR invalide" });
  });

  it("jeton deja utilise -> 409", async () => {
    prismaMock.qRToken.findUnique.mockResolvedValue(qrFor({ status: "UTILISE" }));
    await expect(scanQr("m1", TOKEN)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("jeton expire -> 410 et marquage EXPIRE", async () => {
    prismaMock.qRToken.findUnique.mockResolvedValue(qrFor({ expiresAt: new Date(Date.now() - 1000) }));

    await expect(scanQr("m1", TOKEN)).rejects.toMatchObject({ statusCode: 410, code: "QR_EXPIRED" });
    expect(prismaMock.qRToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "EXPIRE" } }));
  });

  it("commande pas encore prete -> 409", async () => {
    prismaMock.qRToken.findUnique.mockResolvedValue(qrFor({}, { status: "FINANCEMENT_EN_COURS" }));
    await expect(scanQr("m1", TOKEN)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("confirmWithdrawal", () => {
  it("consomme le jeton, livre la commande et declenche le reglement (commission epargne)", async () => {
    const result = await confirmWithdrawal("m1", "order-1", TOKEN);

    expect(tx.qRToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "UTILISE" }) }));
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "LIVREE" } });
    expect(tx.merchantSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ grossAmount: 100_000, commissionAmount: 3_000, netAmount: 97_000, channel: "ORANGE_MONEY" }),
    });
    expect(result.status).toBe("LIVREE");
  });

  it("credit : commission de 4 %", async () => {
    prismaMock.qRToken.findUnique.mockResolvedValue(qrFor({}, { financingMode: "CREDIT" }));

    await confirmWithdrawal("m1", "order-1", TOKEN);

    expect(tx.merchantSettlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ commissionAmount: 4_000, netAmount: 96_000 }),
    });
  });

  it("coffre : le coffre passe a UTILISE", async () => {
    prismaMock.qRToken.findUnique.mockResolvedValue(qrFor({}, { financingMode: "VAULT" }));
    await confirmWithdrawal("m1", "order-1", TOKEN);
    expect(tx.vault.updateMany).toHaveBeenCalledWith({ where: { orderId: "order-1" }, data: { status: "UTILISE" } });
  });

  it("double retrait : la consommation atomique du jeton echoue -> 409, aucune livraison", async () => {
    tx.qRToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(confirmWithdrawal("m1", "order-1", TOKEN)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.merchantSettlement.create).not.toHaveBeenCalled();
  });

  it("refuse un jeton qui ne correspond pas a la commande de l'URL", async () => {
    await expect(confirmWithdrawal("m1", "autre-commande", TOKEN)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuse si le canal de reglement du commercant n'a pas de numero", async () => {
    prismaMock.merchant.findUniqueOrThrow.mockResolvedValue({ id: "m1", defaultPayoutChannel: "CORIS_MONEY", orangeMoneyNumber: "70000000", corisMoneyNumber: null });
    await expect(confirmWithdrawal("m1", "order-1", TOKEN)).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.withdrawal.create).not.toHaveBeenCalled();
  });
});
