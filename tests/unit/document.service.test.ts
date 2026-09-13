jest.mock("@config/prisma", () => ({
  prisma: {
    client: { findFirst: jest.fn() },
    merchant: { findFirst: jest.fn() },
    bankCredit: { findFirst: jest.fn() },
  },
}));

import { prisma } from "@config/prisma";
import { resolvePrivateDocumentPath } from "@modules/documents/document.service";

const mockedPrisma = prisma as unknown as {
  client: { findFirst: jest.Mock };
  merchant: { findFirst: jest.Mock };
  bankCredit: { findFirst: jest.Mock };
};

const FILENAME = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("document.service - resolvePrivateDocumentPath", () => {
  it("rejette un document introuvable", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce(null);
    mockedPrisma.merchant.findFirst.mockResolvedValueOnce(null);

    await expect(
      resolvePrivateDocumentPath(FILENAME, { id: "user-x", role: "CLIENT" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("autorise le proprietaire Client a voir son propre document", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });

    const result = await resolvePrivateDocumentPath(FILENAME, { id: "user-1", role: "CLIENT" });

    expect(result).toContain(FILENAME);
  });

  it("refuse un autre Client que le proprietaire", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });

    await expect(
      resolvePrivateDocumentPath(FILENAME, { id: "un-autre-client", role: "CLIENT" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("autorise toujours l'Admin", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });

    const result = await resolvePrivateDocumentPath(FILENAME, { id: "admin-1", role: "ADMIN" });

    expect(result).toContain(FILENAME);
  });

  it("autorise une Banque assignee a un dossier de credit de ce client", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });
    mockedPrisma.bankCredit.findFirst.mockResolvedValueOnce({ id: "bc-1" });

    const result = await resolvePrivateDocumentPath(FILENAME, { id: "bank-1", role: "BANQUE" });

    expect(result).toContain(FILENAME);
  });

  it("refuse une Banque non assignee a ce client", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce({ id: "client-1", userId: "user-1" });
    mockedPrisma.bankCredit.findFirst.mockResolvedValueOnce(null);

    await expect(
      resolvePrivateDocumentPath(FILENAME, { id: "bank-1", role: "BANQUE" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuse un Commercant qui n'est pas le proprietaire d'un document Merchant", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce(null);
    mockedPrisma.merchant.findFirst.mockResolvedValueOnce({ userId: "user-2" });

    await expect(
      resolvePrivateDocumentPath(FILENAME, { id: "un-autre-commercant", role: "COMMERCANT" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("autorise le Commercant proprietaire de son propre document", async () => {
    mockedPrisma.client.findFirst.mockResolvedValueOnce(null);
    mockedPrisma.merchant.findFirst.mockResolvedValueOnce({ userId: "user-2" });

    const result = await resolvePrivateDocumentPath(FILENAME, { id: "user-2", role: "COMMERCANT" });

    expect(result).toContain(FILENAME);
  });
});
