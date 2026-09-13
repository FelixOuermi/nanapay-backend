jest.mock("@config/prisma", () => {
  const mockedPrisma: Record<string, unknown> = {
    client: { findMany: jest.fn(), findUnique: jest.fn() },
    merchant: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    order: { findMany: jest.fn() },
    bankCredit: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    savingsDeposit: { findMany: jest.fn() },
    merchantPayout: { findMany: jest.fn() },
    notification: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => unknown)(mockedPrisma);
      }
      return Promise.resolve(arg);
    }),
  };
  return { prisma: mockedPrisma };
});

jest.mock("@services/email/emailService", () => ({
  sendAccountApprovedEmail: jest.fn(),
  sendAccountRejectedEmail: jest.fn(),
}));

jest.mock("@modules/payouts/payout.service", () => ({
  createMerchantPayoutForOrder: jest.fn(() => Promise.resolve({ id: "payout-1" })),
}));

jest.mock("@services/notification/notificationService", () => ({ notifyUser: jest.fn(), notifyAdmins: jest.fn() }));

import { prisma } from "@config/prisma";
import { sendAccountApprovedEmail, sendAccountRejectedEmail } from "@services/email/emailService";
import { createMerchantPayoutForOrder } from "@modules/payouts/payout.service";
import * as adminService from "@modules/admin/admin.service";

const mockedPrisma = prisma as unknown as {
  client: { findMany: jest.Mock; findUnique: jest.Mock };
  merchant: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  user: { findUnique: jest.Mock; update: jest.Mock };
  order: { findMany: jest.Mock };
  bankCredit: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  savingsDeposit: { findMany: jest.Mock };
  merchantPayout: { findMany: jest.Mock };
  notification: { findMany: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

const ADMIN_ID = "admin-1";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("admin.service - approveClient", () => {
  it("rejette si le client n'existe pas", async () => {
    mockedPrisma.client.findUnique.mockResolvedValueOnce(null);

    await expect(adminService.approveClient("client-x", ADMIN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejette si le dossier a deja ete traite", async () => {
    mockedPrisma.client.findUnique.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });
    mockedPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", accountStatus: "APPROVED" });

    await expect(adminService.approveClient("client-1", ADMIN_ID)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("active le compte, envoie l'email et journalise l'action pour un dossier en attente", async () => {
    mockedPrisma.client.findUnique.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });
    mockedPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "client@test.com",
      accountStatus: "PENDING",
    });

    const result = await adminService.approveClient("client-1", ADMIN_ID);

    expect(result).toEqual({ id: "client-1", status: "APPROVED" });
    const updateArgs = mockedPrisma.user.update.mock.calls[0][0];
    expect(updateArgs.data.isActive).toBe(true);
    expect(updateArgs.data.accountStatus).toBe("APPROVED");
    expect(sendAccountApprovedEmail).toHaveBeenCalledWith("client@test.com", expect.any(String));
    expect(mockedPrisma.auditLog.create).toHaveBeenCalled();
  });
});

describe("admin.service - rejectClient", () => {
  it("marque le dossier rejete sans activer le compte", async () => {
    mockedPrisma.client.findUnique.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });
    mockedPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "client@test.com",
      accountStatus: "PENDING",
    });

    const result = await adminService.rejectClient("client-1", ADMIN_ID, "Piece d'identite illisible");

    expect(result).toEqual({ id: "client-1", status: "REJECTED" });
    expect(mockedPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { accountStatus: "REJECTED" } })
    );
    expect(sendAccountRejectedEmail).toHaveBeenCalledWith("client@test.com", "Piece d'identite illisible");
  });
});

describe("admin.service - approveMerchant", () => {
  it("active le compte et marque le commercant verifie dans une transaction", async () => {
    mockedPrisma.merchant.findUnique.mockResolvedValueOnce({ id: "merchant-1", userId: "user-2" });
    mockedPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-2",
      email: "commercant@test.com",
      accountStatus: "PENDING",
    });
    mockedPrisma.$transaction.mockResolvedValueOnce([{}, {}]);

    const result = await adminService.approveMerchant("merchant-1", ADMIN_ID);

    expect(result).toEqual({ id: "merchant-1", status: "APPROVED" });
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(sendAccountApprovedEmail).toHaveBeenCalledWith("commercant@test.com", expect.any(String));
  });

  it("rejette si le commercant n'existe pas", async () => {
    mockedPrisma.merchant.findUnique.mockResolvedValueOnce(null);

    await expect(adminService.approveMerchant("merchant-x", ADMIN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("admin.service - listSavingsOverview", () => {
  it("marque le cadre VERT quand l'epargne est terminee et ROUGE sinon", async () => {
    mockedPrisma.order.findMany.mockResolvedValueOnce([
      {
        id: "order-1",
        status: "PRET_A_LIVRER",
        client: { id: "client-1", firstName: "Awa", lastName: "Traore" },
        product: { title: "Chaise" },
        savingsPlan: {
          targetAmount: 30_000,
          currentSavedAmount: 30_000,
          dueDate: new Date(),
          isCompleted: true,
          penaltyApplied: false,
        },
      },
      {
        id: "order-2",
        status: "EN_COURS",
        client: { id: "client-2", firstName: "Issa", lastName: "Kone" },
        product: { title: "Table" },
        savingsPlan: {
          targetAmount: 30_000,
          currentSavedAmount: 10_000,
          dueDate: new Date(),
          isCompleted: false,
          penaltyApplied: false,
        },
      },
    ]);

    const result = await adminService.listSavingsOverview();

    expect(result[0].cadre).toBe("VERT");
    expect(result[0].progressPercent).toBe(100);
    expect(result[1].cadre).toBe("ROUGE");
    expect(result[1].progressPercent).toBe(33);
  });
});

describe("admin.service - processCreditPayout", () => {
  const bankCredit = {
    id: "bc-1",
    transferStatus: "VIREMENT_BANQUE_EFFECTUE",
    order: { id: "order-1", product: { shop: { merchantId: "merchant-1" } }, savingsPlan: null },
  };

  it("rejette un dossier introuvable", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(null);

    await expect(adminService.processCreditPayout("bc-x", ADMIN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejette si le virement de la banque n'a pas encore ete recu", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce({
      ...bankCredit,
      transferStatus: "NON_EFFECTUE",
    });

    await expect(adminService.processCreditPayout("bc-1", ADMIN_ID)).rejects.toMatchObject({ statusCode: 409 });
    expect(createMerchantPayoutForOrder).not.toHaveBeenCalled();
  });

  it("cree le reversement commercant et marque le credit PAYE_AU_COMMERCANT", async () => {
    mockedPrisma.bankCredit.findUnique.mockResolvedValueOnce(bankCredit);

    const result = await adminService.processCreditPayout("bc-1", ADMIN_ID);

    expect(createMerchantPayoutForOrder).toHaveBeenCalledWith(expect.anything(), bankCredit.order, "merchant-1");
    expect(mockedPrisma.bankCredit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { transferStatus: "PAYE_AU_COMMERCANT" } })
    );
    expect(result).toEqual({ id: "payout-1" });
  });
});

describe("admin.service - listTransactions / listAdminNotifications", () => {
  it("agrege depots Epargne et reversements commercants", async () => {
    mockedPrisma.savingsDeposit.findMany.mockResolvedValueOnce([]);
    mockedPrisma.merchantPayout.findMany.mockResolvedValueOnce([]);

    const result = await adminService.listTransactions();

    expect(result).toEqual({ savingsDeposits: [], merchantPayouts: [] });
  });

  it("liste les notifications de l'admin connecte uniquement", async () => {
    mockedPrisma.notification.findMany.mockResolvedValueOnce([]);

    await adminService.listAdminNotifications(ADMIN_ID);

    expect(mockedPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: ADMIN_ID } })
    );
  });
});
