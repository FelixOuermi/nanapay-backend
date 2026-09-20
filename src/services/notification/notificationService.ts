import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** Notifie tous les comptes Admin d'un evenement metier a suivre. */
export async function notifyAdmins(title: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  if (admins.length === 0) return;

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      title,
      message,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    })),
  });
}

/** Notifie un utilisateur precis (Client, Commercant, Banque) d'un evenement le concernant. */
export async function notifyUser(
  userId: string,
  title: string,
  message: string,
  metadata?: Record<string, unknown>,
  db: Db = prisma
): Promise<void> {
  await db.notification.create({
    data: { userId, title, message, metadata: metadata as Prisma.InputJsonValue | undefined },
  });
}

export async function listUserNotifications(userId: string, skip: number, take: number, unreadOnly = false) {
  const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.notification.count({ where }),
  ]);
  return { items, total };
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
  return result.count > 0;
}
