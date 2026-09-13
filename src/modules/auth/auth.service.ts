import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { AppError } from "@common/errors/AppError";
import { hashPassword, verifyPassword, generateTemporaryPassword } from "@common/utils/password";
import { generateAccessToken, generateOpaqueRefreshToken, hashToken } from "@common/utils/token";
import { parseDurationMs } from "@common/utils/duration";
import { recordAudit } from "@services/audit/auditService";
import { sendPasswordResetEmail } from "@services/email/emailService";
import { PayoutChannel } from "@prisma/client";

interface RegisterClientInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  city: string;
  township: string;
  sector: string;
  cnibRectoUrl: string;
  cnibVersoUrl: string;
}

interface RegisterMerchantInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  ifuRccmNumber: string;
  city: string;
  orangeMoneyNumber?: string;
  corisMoneyNumber?: string;
  defaultPayoutAccount: PayoutChannel;
  cnibRectoUrl: string;
  cnibVersoUrl: string;
}

async function assertEmailAvailable(email: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw AppError.conflict("Un compte existe deja avec cet e-mail");
  }
}

export async function registerClient(input: RegisterClientInput) {
  await assertEmailAvailable(input.email);
  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: "CLIENT",
      isActive: false,
      client: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          phoneNumber: input.phoneNumber,
          city: input.city,
          township: input.township,
          sector: input.sector,
          cnibRectoUrl: input.cnibRectoUrl,
          cnibVersoUrl: input.cnibVersoUrl,
        },
      },
    },
    include: { client: true },
  });

  await recordAudit({ userId: user.id, action: "CLIENT_REGISTERED", entityType: "user", entityId: user.id });

  return { id: user.id, email: user.email, status: "EN_ATTENTE_VALIDATION" as const };
}

export async function registerMerchant(input: RegisterMerchantInput) {
  await assertEmailAvailable(input.email);
  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: "COMMERCANT",
      isActive: false,
      merchant: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          ifuRccmNumber: input.ifuRccmNumber,
          city: input.city,
          orangeMoneyNumber: input.orangeMoneyNumber,
          corisMoneyNumber: input.corisMoneyNumber,
          defaultPayoutAccount: input.defaultPayoutAccount,
          cnibRectoUrl: input.cnibRectoUrl,
          cnibVersoUrl: input.cnibVersoUrl,
        },
      },
    },
    include: { merchant: true },
  });

  await recordAudit({ userId: user.id, action: "MERCHANT_REGISTERED", entityType: "user", entityId: user.id });

  return { id: user.id, email: user.email, status: "EN_ATTENTE_VALIDATION" as const };
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(user: {
  id: string;
  role: "ADMIN" | "CLIENT" | "COMMERCANT" | "BANQUE";
  clientId?: string;
  merchantId?: string;
}): Promise<AuthTokens> {
  const accessToken = generateAccessToken({
    sub: user.id,
    role: user.role,
    clientId: user.clientId,
    merchantId: user.merchantId,
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

export async function login(email: string, password: string) {
  // Reponse volontairement generique tant que le mot de passe n'est pas verifie,
  // pour ne pas reveler si un compte existe avec cet e-mail.
  const invalidCredentials = () => AppError.unauthorized("Identifiants invalides");

  const user = await prisma.user.findUnique({
    where: { email },
    include: { client: true, merchant: true },
  });

  if (!user) {
    throw invalidCredentials();
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    throw invalidCredentials();
  }

  if (!user.isActive) {
    // isActive peut passer a false soit avant validation Admin (accountStatus PENDING),
    // soit apres un blocage temporaire (ex: penalite Epargne pour delai depasse) alors
    // que le dossier reste APPROVED : le message ne doit pas induire l'utilisateur en erreur.
    throw AppError.forbidden(
      user.accountStatus === "PENDING"
        ? "Compte en attente de validation par l'Admin"
        : "Compte temporairement bloque, contactez le support NanaPay"
    );
  }

  const tokens = await issueTokens({
    id: user.id,
    role: user.role,
    clientId: user.client?.id,
    merchantId: user.merchant?.id,
  });

  await recordAudit({ userId: user.id, action: "USER_LOGIN", entityType: "user", entityId: user.id });

  return {
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      clientId: user.client?.id,
      merchantId: user.merchant?.id,
    },
  };
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const tokenHash = hashToken(refreshToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { client: true, merchant: true } } },
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw AppError.unauthorized("Refresh token invalide ou expire");
  }

  // Rotation : l'ancien refresh token est revoque des qu'il est utilise.
  await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });

  return issueTokens({
    id: existing.user.id,
    role: existing.user.role,
    clientId: existing.user.client?.id,
    merchantId: existing.user.merchant?.id,
  });
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  // Idempotent : que le token existe ou non, la reponse est la meme cote client.
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
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
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await sendPasswordResetEmail(user.email, temporaryPassword);
  await recordAudit({ userId: user.id, action: "ACCOUNT_RECOVERY_REQUESTED", entityType: "user", entityId: user.id });
}
