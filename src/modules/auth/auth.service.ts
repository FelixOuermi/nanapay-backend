import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { AppError } from "@common/errors/AppError";
import { hashPassword, verifyPassword, generateTemporaryPassword } from "@common/utils/password";
import { generateAccessToken, generateOpaqueRefreshToken, hashToken } from "@common/utils/token";
import { parseDurationMs } from "@common/utils/duration";
import { recordAudit } from "@services/audit/auditService";
import { sendPasswordResetEmail } from "@services/email/emailService";
import { RegisterInput } from "./auth.validation";

interface CnibUrls {
  cnibRectoUrl: string;
  cnibVersoUrl: string;
}

async function assertEmailAvailable(email: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw AppError.conflict("Un compte existe deja avec cet e-mail");
  }
}

async function assertLocationExists(cityId: string, communeId: string): Promise<void> {
  const commune = await prisma.commune.findUnique({ where: { id: communeId } });
  if (!commune || commune.cityId !== cityId) {
    throw AppError.badRequest("Ville ou commune invalide");
  }
}

export async function register(input: RegisterInput, cnib: CnibUrls) {
  await assertEmailAvailable(input.email);
  const passwordHash = await hashPassword(input.password);

  if (input.role === "CLIENT") {
    await assertLocationExists(input.cityId, input.communeId);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        role: "CLIENT",
        client: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
            phoneNumber: input.phoneNumber,
            cityId: input.cityId,
            communeId: input.communeId,
            ...cnib,
          },
        },
      },
    });

    await recordAudit({ userId: user.id, actorRole: "CLIENT", action: "CLIENT_REGISTERED", entityType: "user", entityId: user.id });
    return { id: user.id, email: user.email, role: user.role, status: "ACTIF" as const };
  }

  if (!input.orangeMoneyNumber && !input.corisMoneyNumber) {
    throw AppError.badRequest("Au moins un numero Mobile Money (Orange Money ou Coris Money) est requis");
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: "MERCHANT",
      merchant: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          ifuRccmNumber: input.ifuRccmNumber,
          orangeMoneyNumber: input.orangeMoneyNumber,
          corisMoneyNumber: input.corisMoneyNumber,
          defaultPayoutChannel: input.defaultPayoutChannel,
          ...cnib,
        },
      },
    },
  });

  await recordAudit({ userId: user.id, actorRole: "MERCHANT", action: "MERCHANT_REGISTERED", entityType: "user", entityId: user.id });
  return { id: user.id, email: user.email, role: user.role, status: "EN_ATTENTE" as const };
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface TokenSubject {
  id: string;
  role: UserRole;
  clientId?: string;
  merchantId?: string;
  bankId?: string;
}

async function issueTokens(user: TokenSubject): Promise<AuthTokens> {
  const accessToken = generateAccessToken({
    sub: user.id,
    role: user.role,
    clientId: user.clientId,
    merchantId: user.merchantId,
    bankId: user.bankId,
  });

  const refreshToken = generateOpaqueRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRES_IN)),
    },
  });

  return { accessToken, refreshToken };
}

const WITH_PROFILES = { client: true, merchant: true, bank: true } as const;

function toSubject(user: {
  id: string;
  role: UserRole;
  client: { id: string } | null;
  merchant: { id: string } | null;
  bank: { id: string } | null;
}): TokenSubject {
  return {
    id: user.id,
    role: user.role,
    clientId: user.client?.id,
    merchantId: user.merchant?.id,
    bankId: user.bank?.id,
  };
}

export async function login(email: string, password: string) {
  // Reponse generique tant que le mot de passe n'est pas verifie : ne revele pas l'existence du compte.
  const invalidCredentials = () => AppError.unauthorized("Identifiants invalides");

  const user = await prisma.user.findUnique({ where: { email }, include: WITH_PROFILES });
  if (!user) {
    throw invalidCredentials();
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw invalidCredentials();
  }

  if (!user.isActive || user.client?.status === "SUSPENDU" || user.merchant?.status === "SUSPENDU") {
    throw AppError.forbidden("Compte suspendu, contactez le support NanoPay");
  }

  const subject = toSubject(user);
  const tokens = await issueTokens(subject);

  await recordAudit({ userId: user.id, actorRole: user.role, action: "USER_LOGIN", entityType: "user", entityId: user.id });

  return {
    ...tokens,
    user: { ...subject, email: user.email, merchantStatus: user.merchant?.status },
  };
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: WITH_PROFILES } },
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date() || !existing.user.isActive) {
    throw AppError.unauthorized("Refresh token invalide ou expire");
  }

  // Rotation : l'ancien refresh token est revoque des qu'il est utilise. updateMany
  // conditionnel : deux refresh simultanes avec le meme token ne peuvent pas tous deux reussir.
  const revoked = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) {
    throw AppError.unauthorized("Refresh token invalide ou expire");
  }

  return issueTokens(toSubject(existing.user));
}

export async function logout(refreshToken: string): Promise<void> {
  // Idempotent : que le token existe ou non, la reponse est la meme cote client.
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function requestAccountRecovery(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Ne jamais reveler si l'e-mail existe : la reponse HTTP est identique dans tous les cas.
  if (!user) {
    return;
  }

  const temporaryPassword = generateTemporaryPassword();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(temporaryPassword) } });
  await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });

  await sendPasswordResetEmail(user.email, temporaryPassword);
  await recordAudit({ userId: user.id, actorRole: user.role, action: "ACCOUNT_RECOVERY_REQUESTED", entityType: "user", entityId: user.id });
}

// ------------------------------------------------------------------
// GET / PATCH /me
// ------------------------------------------------------------------

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: { include: { city: true, commune: true, creditProfile: { select: { status: true } } } },
      merchant: { include: { store: { select: { id: true, name: true } } } },
      bank: true,
    },
  });

  if (!user) {
    throw AppError.notFound("Utilisateur introuvable");
  }

  const { passwordHash: _passwordHash, client, merchant, bank, ...account } = user;
  void _passwordHash;

  return {
    ...account,
    client: client && { ...client, cnibRectoUrl: undefined, cnibVersoUrl: undefined },
    merchant: merchant && { ...merchant, cnibRectoUrl: undefined, cnibVersoUrl: undefined },
    bank,
  };
}

interface UpdateMeInput {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  cityId?: string;
  communeId?: string;
  orangeMoneyNumber?: string;
  corisMoneyNumber?: string;
  defaultPayoutChannel?: "ORANGE_MONEY" | "CORIS_MONEY";
  currentPassword?: string;
  newPassword?: string;
}

export async function updateMe(userId: string, role: UserRole, input: UpdateMeInput) {
  if (input.newPassword) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(input.currentPassword ?? "", user.passwordHash))) {
      throw AppError.unauthorized("Mot de passe actuel incorrect");
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword) } });
    // Toutes les sessions existantes sont revoquees apres un changement de mot de passe.
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  if (role === "CLIENT") {
    if (input.cityId || input.communeId) {
      const current = await prisma.client.findUniqueOrThrow({ where: { userId } });
      await assertLocationExists(input.cityId ?? current.cityId ?? "", input.communeId ?? current.communeId ?? "");
    }
    const data: Prisma.ClientUpdateInput = {};
    if (input.firstName) data.firstName = input.firstName;
    if (input.lastName) data.lastName = input.lastName;
    if (input.phoneNumber) data.phoneNumber = input.phoneNumber;
    if (input.cityId) data.city = { connect: { id: input.cityId } };
    if (input.communeId) data.commune = { connect: { id: input.communeId } };
    if (Object.keys(data).length > 0) await prisma.client.update({ where: { userId }, data });
  } else if (role === "MERCHANT") {
    const data: Prisma.MerchantUpdateInput = {};
    if (input.firstName) data.firstName = input.firstName;
    if (input.lastName) data.lastName = input.lastName;
    if (input.orangeMoneyNumber) data.orangeMoneyNumber = input.orangeMoneyNumber;
    if (input.corisMoneyNumber) data.corisMoneyNumber = input.corisMoneyNumber;
    if (input.defaultPayoutChannel) data.defaultPayoutChannel = input.defaultPayoutChannel;
    if (Object.keys(data).length > 0) await prisma.merchant.update({ where: { userId }, data });
  }

  await recordAudit({ userId, actorRole: role, action: "PROFILE_UPDATED", entityType: "user", entityId: userId });
  return getMe(userId);
}
