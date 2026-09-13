jest.mock("@config/prisma", () => {
  const mockedPrisma: Record<string, unknown> = {
    bankCredit: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    client: { update: jest.fn() },
    order: { update: jest.fn() },
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
jest.mock("@services/notification/notificationService", () => ({ notifyAdmins: jest.fn(), notifyUser: jest.fn() }));
jest.mock("@services/qr/qrService", () => ({ generateQrToken: jest.fn(() => "fixed-qr-token") }));

import { prisma } from "@config/prisma";
import * as bankService from "@modules/bank/bank.service";

const mockedPrisma = prisma as unknown as {
  bankCredit: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  client: { update: jest.Mock };
  order: { update: jest.Mock };
};

const BANK_ID = "bank-1";

function makeBankCredit(overrides: Record<string, unknown> = {}) {
  return {
    id: "bc-1",
    bankId: BANK_ID,
    orderId: "order-1",
    approvalStatus: "EN_ATTENTE",
    transferStatus: "NON_EFFECTUE",
    totalAmountToWire: 51_000,
    order: {
      id: "order-1",
      client: { id: "client-1", userId: "user-1", firstName: "Awa", lastName: "Traore" },
      product: {
        shop: {
          merchant: { firstName: "Issa", lastName: "Kone", corisMoneyNumber: "70000000" },
        },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("bank.service - ownership", () => {
  it("refuse un dossier assigne a une autre banque (404, pas 403)", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(makeBankCredit({ bankId: "une-autre-banque" }));

    await expect(bankService.getCreditRequestDetail(BANK_ID, "bc-1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("bank.service - approveCreditRequest", () => {
  it("refuse un dossier deja traite", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(makeBankCredit({ approvalStatus: "APPROUVE" }));

    await expect(bankService.approveCreditRequest(BANK_ID, "bc-1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("approuve et rend le dossier client reutilisable (bankDossierStatus VALIDE)", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(makeBankCredit());

    const result = await bankService.approveCreditRequest(BANK_ID, "bc-1");

    expect(result).toEqual({ id: "bc-1", status: "APPROUVE" });
    expect(mockedPrisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bankDossierStatus: "VALIDE" } })
    );
  });
});

describe("bank.service - rejectCreditRequest", () => {
  it("annule la commande sans toucher au dossier KYC du client", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(makeBankCredit());

    const result = await bankService.rejectCreditRequest(BANK_ID, "bc-1", "Revenus insuffisants");

    expect(result).toEqual({ id: "bc-1", status: "REJETTE" });
    expect(mockedPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ANNULE" } })
    );
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });
});

describe("bank.service - executeTransfer", () => {
  it("refuse si le dossier n'est pas encore approuve", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(makeBankCredit({ approvalStatus: "EN_ATTENTE" }));

    await expect(bankService.executeTransfer(BANK_ID, "bc-1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuse un virement deja effectue", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(
      makeBankCredit({ approvalStatus: "APPROUVE", transferStatus: "VIREMENT_BANQUE_EFFECTUE" })
    );

    await expect(bankService.executeTransfer(BANK_ID, "bc-1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("genere le QR et passe la commande a PRET_A_LIVRER une fois le virement effectue", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(makeBankCredit({ approvalStatus: "APPROUVE" }));

    const result = await bankService.executeTransfer(BANK_ID, "bc-1");

    expect(result).toEqual({ id: "bc-1", transferStatus: "VIREMENT_BANQUE_EFFECTUE" });
    expect(mockedPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PRET_A_LIVRER", qrCodeToken: "fixed-qr-token" } })
    );
  });
});
