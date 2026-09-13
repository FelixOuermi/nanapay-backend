import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";

/** Notifie tous les comptes Admin (table notifications) d'un evenement metier a suivre. */
export async function notifyAdmins(
  title: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });

  if (admins.length === 0) {
    return;
  }

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      title,
      message,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    })),
  });
}

/** Notifie un utilisateur precis (Client, Commercant...) d'un evenement le concernant. */
export async function notifyUser(
  userId: string,
  title: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.notification.create({
    data: { userId, title, message, metadata: metadata as Prisma.InputJsonValue | undefined },
  });
}

/** Notifications d'un utilisateur donne (Admin, Client, Commercant...), les plus recentes en premier. */
export async function listUserNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
