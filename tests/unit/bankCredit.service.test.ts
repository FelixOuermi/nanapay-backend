jest.mock("@config/prisma", () => ({
  prisma: {
    order: { findUnique: jest.fn() },
    client: { findUnique: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn() },
    bankCredit: { create: jest.fn() },
  },
}));

jest.mock("@services/audit/auditService", () => ({ recordAudit: jest.fn() }));

import { prisma } from "@config/prisma";
import * as bankCreditService from "@modules/bankCredits/bankCredit.service";

const mockedPrisma = prisma as unknown as {
  order: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock; update: jest.Mock };
  user: { findFirst: jest.Mock };
  bankCredit: { create: jest.Mock };
};

const CLIENT_ID = "client-1";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("bankCredit.service - submitOrReuseDossier", () => {
  it("rejette une commande qui n'appartient pas au client", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({ id: "order-1", clientId: "un-autre" });

    await expect(bankCreditService.submitOrReuseDossier(CLIENT_ID, "order-1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejette une commande qui n'est pas en Credit Bancaire", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      clientId: CLIENT_ID,
      paymentMode: "EPARGNE",
    });

    await expect(bankCreditService.submitOrReuseDossier(CLIENT_ID, "order-1")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("reutilise le dossier deja au dossier du client sans demander de nouveaux fichiers", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      clientId: CLIENT_ID,
      paymentMode: "CREDIT_BANCAIRE",
    });
    mockedPrisma.client.findUnique.mockResolvedValueOnce({
      id: CLIENT_ID,
      employer: "Ministere X",
      bankAuthorizationUrl: "uploads/private/a.pdf",
      paySlipsUrl: "uploads/private/b.pdf",
      bankDossierStatus: "VALIDE",
    });

    const result = await bankCreditService.submitOrReuseDossier(CLIENT_ID, "order-1");

    expect(result).toEqual({ dossierStatus: "VALIDE", reused: true });
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("refuse si aucun dossier n'existe et qu'aucun fichier n'est fourni", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      clientId: CLIENT_ID,
      paymentMode: "CREDIT_BANCAIRE",
    });
    mockedPrisma.client.findUnique.mockResolvedValueOnce({ id: CLIENT_ID, employer: null });

    await expect(bankCreditService.submitOrReuseDossier(CLIENT_ID, "order-1")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("enregistre un nouveau dossier et le passe en EN_ATTENTE", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      clientId: CLIENT_ID,
      paymentMode: "CREDIT_BANCAIRE",
    });
    mockedPrisma.client.findUnique.mockResolvedValueOnce({ id: CLIENT_ID, employer: null });

    const result = await bankCreditService.submitOrReuseDossier(CLIENT_ID, "order-1", {
      employer: "Ministere X",
      bankAuthorizationUrl: "uploads/private/a.pdf",
      paySlipsUrl: "uploads/private/b.pdf",
    });

    expect(result).toEqual({ dossierStatus: "EN_ATTENTE", reused: false });
    expect(mockedPrisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bankDossierStatus: "EN_ATTENTE" }) })
    );
  });
});

describe("bankCredit.service - setBankCreditTerms", () => {
  const orderWithDossier = {
    id: "order-1",
    clientId: CLIENT_ID,
    paymentMode: "CREDIT_BANCAIRE" as const,
    totalAmount: 50_000,
    bankCredit: null,
  };

  it("refuse si les modalites existent deja pour cette commande", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce({ ...orderWithDossier, bankCredit: { id: "bc-1" } });

    await expect(bankCreditService.setBankCreditTerms(CLIENT_ID, "order-1", 8)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("refuse si le dossier n'a pas ete soumis", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(orderWithDossier);
    mockedPrisma.client.findUnique.mockResolvedValueOnce({ employer: null });

    await expect(bankCreditService.setBankCreditTerms(CLIENT_ID, "order-1", 8)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuse une duree hors limite pour le prix de l'article", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(orderWithDossier);
    mockedPrisma.client.findUnique.mockResolvedValueOnce({
      employer: "X",
      bankAuthorizationUrl: "a",
      paySlipsUrl: "b",
    });

    await expect(bankCreditService.setBankCreditTerms(CLIENT_ID, "order-1", 9)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuse si aucune banque partenaire n'est disponible", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(orderWithDossier);
    mockedPrisma.client.findUnique.mockResolvedValueOnce({
      employer: "X",
      bankAuthorizationUrl: "a",
      paySlipsUrl: "b",
    });
    mockedPrisma.user.findFirst.mockResolvedValueOnce(null);

    await expect(bankCreditService.setBankCreditTerms(CLIENT_ID, "order-1", 8)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("calcule la commission de 2% et le montant a virer selon l'exemple du document (50 000 FCFA)", async () => {
    mockedPrisma.order.findUnique.mockResolvedValueOnce(orderWithDossier);
    mockedPrisma.client.findUnique.mockResolvedValueOnce({
      employer: "X",
      bankAuthorizationUrl: "a",
      paySlipsUrl: "b",
    });
    mockedPrisma.user.findFirst.mockResolvedValueOnce({ id: "bank-1" });
    mockedPrisma.bankCredit.create.mockResolvedValueOnce({ id: "bc-1" });

    await bankCreditService.setBankCreditTerms(CLIENT_ID, "order-1", 8);

    const createArgs = mockedPrisma.bankCredit.create.mock.calls[0][0];
    expect(createArgs.data.bankId).toBe("bank-1");
    expect(createArgs.data.bankCommissionAmount).toBe(1_000);
    expect(createArgs.data.totalAmountToWire).toBe(51_000);
    expect(createArgs.data.monthlyInstallment).toBeCloseTo(51_000 / 8, 2);
  });
});
