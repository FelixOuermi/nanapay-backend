import path from "node:path";
import { UserRole } from "@prisma/client";
import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { env } from "@config/env";

interface Requester {
  id: string;
  role: UserRole;
}

/**
 * Retrouve a qui appartient un document prive (CNIB, bulletins, autorisation de
 * prelevement) a partir de son seul nom de fichier, et verifie que le demandeur a le
 * droit de le consulter. Ces documents ne sont jamais servis statiquement (contrairement
 * aux medias produits) : cet endpoint est le seul point d'acces, avec controle d'acces.
 *
 * Droits : le proprietaire peut toujours voir ses propres documents ; l'Admin peut tout
 * voir (KYC) ; une Banque ne peut voir les documents d'un Client que si elle a ete
 * assignee a au moins un dossier de credit de ce client (peu importe son statut).
 */
export async function resolvePrivateDocumentPath(filename: string, requester: Requester): Promise<string> {
  const client = await prisma.client.findFirst({
    where: {
      OR: [
        { cnibRectoUrl: filename },
        { cnibVersoUrl: filename },
        { bankAuthorizationUrl: filename },
        { paySlipsUrl: filename },
      ],
    },
    select: { id: true, userId: true },
  });

  if (client) {
    const isOwner = client.userId === requester.id;
    const isAdmin = requester.role === "ADMIN";
    const isAssignedBank =
      requester.role === "BANQUE" &&
      (await prisma.bankCredit.findFirst({
        where: { bankId: requester.id, order: { clientId: client.id } },
        select: { id: true },
      })) !== null;

    if (!isOwner && !isAdmin && !isAssignedBank) {
      throw AppError.forbidden("Vous n'etes pas autorise a consulter ce document");
    }

    return path.join(env.UPLOAD_DIR, "private", filename);
  }

  const merchant = await prisma.merchant.findFirst({
    where: { OR: [{ cnibRectoUrl: filename }, { cnibVersoUrl: filename }] },
    select: { userId: true },
  });

  if (merchant) {
    const isOwner = merchant.userId === requester.id;
    const isAdmin = requester.role === "ADMIN";

    if (!isOwner && !isAdmin) {
      throw AppError.forbidden("Vous n'etes pas autorise a consulter ce document");
    }

    return path.join(env.UPLOAD_DIR, "private", filename);
  }

  throw AppError.notFound("Document introuvable");
}
