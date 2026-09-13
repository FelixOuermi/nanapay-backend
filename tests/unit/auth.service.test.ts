jest.mock("@config/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

jest.mock("@services/email/emailService", () => ({
  sendPasswordResetEmail: jest.fn(),
}));

import { prisma } from "@config/prisma";
import { sendPasswordResetEmail } from "@services/email/emailService";
import * as authService from "@modules/auth/auth.service";

const mockedPrisma = prisma as unknown as {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  refreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  auditLog: { create: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("auth.service - registerClient", () => {
  it("refuse un e-mail deja utilise", async () => {
    mockedPrisma.user.findUnique.mockResolvedValueOnce({ id: "existing" });

    await expect(
      authService.registerClient({
        email: "client@test.com",
        password: "password123",
        firstName: "Awa",
        lastName: "Traore",
        phoneNumber: "70000000",
        city: "Ouaga",
        township: "Baskuy",
        sector: "Secteur 10",
        cnibRectoUrl: "uploads/recto.jpg",
        cnibVersoUrl: "uploads/verso.jpg",
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
  });

  it("cree un compte Client inactif en attente de validation Admin", async () => {
    mockedPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockedPrisma.user.create.mockResolvedValueOnce({ id: "user-1", email: "client@test.com" });

    const result = await authService.registerClient({
      email: "client@test.com",
      password: "password123",
      firstName: "Awa",
      lastName: "Traore",
      phoneNumber: "70000000",
      city: "Ouaga",
      township: "Baskuy",
      sector: "Secteur 10",
      cnibRectoUrl: "uploads/recto.jpg",
      cnibVersoUrl: "uploads/verso.jpg",
    });

    expect(result.status).toBe("EN_ATTENTE_VALIDATION");
    const createArgs = mockedPrisma.user.create.mock.calls[0][0];
    expect(createArgs.data.isActive).toBe(false);
    expect(createArgs.data.role).toBe("CLIENT");
    expect(mockedPrisma.auditLog.create).toHaveBeenCalled();
  });
});

describe("auth.service - login", () => {
  const activeUser = {
    id: "user-1",
    email: "client@test.com",
    role: "CLIENT" as const,
    isActive: true,
    passwordHash: "",
    client: { id: "client-1" },
    merchant: null,
  };

  it("refuse un e-mail inconnu", async () => {
    mockedPrisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(authService.login("inconnu@test.com", "whatever")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuse un mot de passe incorrect sans reveler la raison", async () => {
    const { hashPassword } = await import("@common/utils/password");
    mockedPrisma.user.findUnique.mockResolvedValueOnce({
      ...activeUser,
      passwordHash: await hashPassword("bon-mot-de-passe"),
    });

    await expect(authService.login(activeUser.email, "mauvais-mot-de-passe")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("refuse un compte non encore valide par l'Admin", async () => {
    const { hashPassword } = await import("@common/utils/password");
    mockedPrisma.user.findUnique.mockResolvedValueOnce({
      ...activeUser,
      isActive: false,
      passwordHash: await hashPassword("password123"),
    });

    await expect(authService.login(activeUser.email, "password123")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("retourne des tokens et le profil pour des identifiants valides", async () => {
    const { hashPassword } = await import("@common/utils/password");
    mockedPrisma.user.findUnique.mockResolvedValueOnce({
      ...activeUser,
      passwordHash: await hashPassword("password123"),
    });

    const result = await authService.login(activeUser.email, "password123");

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user).toMatchObject({ id: "user-1", role: "CLIENT", clientId: "client-1" });
    expect(mockedPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });
});

describe("auth.service - refresh", () => {
  it("rejette un refresh token inconnu", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValueOnce(null);

    await expect(authService.refresh("token-invalide")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejette un refresh token revoque", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: "rt-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 100_000),
      user: { id: "user-1", role: "CLIENT", client: { id: "client-1" }, merchant: null },
    });

    await expect(authService.refresh("token-revoque")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejette un refresh token expire", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: "rt-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      user: { id: "user-1", role: "CLIENT", client: { id: "client-1" }, merchant: null },
    });

    await expect(authService.refresh("token-expire")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("effectue une rotation : revoque l'ancien et emet un nouveau refresh token", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: "rt-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100_000),
      user: { id: "user-1", role: "CLIENT", client: { id: "client-1" }, merchant: null },
    });

    const result = await authService.refresh("token-valide");

    expect(mockedPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rt-1" }, data: expect.objectContaining({ revokedAt: expect.any(Date) }) })
    );
    expect(mockedPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });
});

describe("auth.service - logout", () => {
  it("revoque le refresh token fourni de maniere idempotente", async () => {
    await authService.logout("un-refresh-token");

    expect(mockedPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) })
    );
  });
});

describe("auth.service - requestAccountRecovery", () => {
  it("ne revele pas si l'e-mail est inconnu (aucune action effectuee)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValueOnce(null);

    await authService.requestAccountRecovery("inconnu@test.com");

    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("genere un mot de passe temporaire et l'envoie par e-mail pour un compte existant", async () => {
    mockedPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "client@test.com" });

    await authService.requestAccountRecovery("client@test.com");

    expect(mockedPrisma.user.update).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith("client@test.com", expect.any(String));
  });
});

