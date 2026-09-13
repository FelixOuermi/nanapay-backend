import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";

export async function getProfile(userId: string) {
  const client = await prisma.client.findUnique({
    where: { userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phoneNumber: true,
      city: true,
      township: true,
      sector: true,
      employer: true,
      bankDossierStatus: true,
      createdAt: true,
      user: { select: { email: true, accountStatus: true, isActive: true } },
    },
  });

  if (!client) {
    throw AppError.notFound("Profil client introuvable");
  }

  return client;
}
