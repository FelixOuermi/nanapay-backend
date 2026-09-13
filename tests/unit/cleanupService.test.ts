jest.mock("@config/prisma", () => ({
  prisma: {
    idempotencyKey: { deleteMany: jest.fn() },
    refreshToken: { deleteMany: jest.fn() },
  },
}));
jest.mock("@config/logger", () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

import { prisma } from "@config/prisma";
import { cleanupExpiredRecords } from "@services/maintenance/cleanupService";

const mockedPrisma = prisma as unknown as {
  idempotencyKey: { deleteMany: jest.Mock };
  refreshToken: { deleteMany: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("cleanupService - cleanupExpiredRecords", () => {
  it("supprime les cles d'idempotence expirees", async () => {
    mockedPrisma.idempotencyKey.deleteMany.mockResolvedValueOnce({ count: 3 });
    mockedPrisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 0 });

    await cleanupExpiredRecords();

    const args = mockedPrisma.idempotencyKey.deleteMany.mock.calls[0][0];
    expect(args.where.expiresAt.lt).toBeInstanceOf(Date);
  });

  it("supprime les refresh tokens expires ou revoques depuis longtemps", async () => {
    mockedPrisma.idempotencyKey.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockedPrisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 2 });

    await cleanupExpiredRecords();

    const args = mockedPrisma.refreshToken.deleteMany.mock.calls[0][0];
    expect(args.where.OR).toHaveLength(2);
  });
});
