import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { addHours } from "@common/utils/date";

/**
 * Jeton opaque (256 bits d'entropie). Le QR affiche par le frontend ne contient que ce
 * jeton : aucune donnee metier n'y est encodee, tout est resolu cote serveur
 * (cahier, section 7).
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Emet un nouveau jeton QR pour la commande : les jetons encore GENERE sont passes a
 * EXPIRE pour qu'un seul jeton soit valide a la fois.
 */
export async function issueQrToken(tx: Prisma.TransactionClient, orderId: string, ttlHours: number) {
  await tx.qRToken.updateMany({ where: { orderId, status: "GENERE" }, data: { status: "EXPIRE" } });
  return tx.qRToken.create({
    data: { orderId, token: generateOpaqueToken(), expiresAt: addHours(new Date(), ttlHours) },
  });
}
