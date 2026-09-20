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
 * Droits : le proprietaire voit ses propres documents ; l'Admin voit tout ; une Banque
 * ne voit que les documents bancaires (et la CNIB) des clients dont le profil credit ou
 * une demande de credit lui est assigne.
 */
export async function resolvePrivateDocumentPath(filename: string, requester: Requester): Promise<string> {
  const isAdmin = requester.role === "ADMIN";
  const privatePath = path.join(env.UPLOAD_DIR, "private", path.basename(filename));

  const client = await prisma.client.findFirst({
    where: {
      OR: [
        { cnibRectoUrl: filename },
        { cnibVersoUrl: filename },
        { creditProfile: { OR: [{ bankAuthorizationUrl: filename }, { paySlipsUrl: filename }] } },
      ],
    },
    select: { id: true, userId: true },
  });

  if (client) {
    const isOwner = client.userId === requester.id;
    let isAssignedBank = false;

    if (requester.role === "BANK") {
      const bank = await prisma.bank.findUnique({ where: { userId: requester.id }, select: { id: true } });
      if (bank) {
        isAssignedBank =
          (await prisma.creditProfile.findFirst({ where: { clientId: client.id, bankId: bank.id }, select: { id: true } })) !== null ||
          (await prisma.creditRequest.findFirst({ where: { clientId: client.id, bankId: bank.id }, select: { id: true } })) !== null;
      }
    }

    if (!isOwner && !isAdmin && !isAssignedBank) {
      throw AppError.forbidden("Vous n'etes pas autorise a consulter ce document");
    }
    return privatePath;
  }

  const vault = await prisma.vault.findFirst({
    where: { salaryDebitAuthorizationUrl: filename },
    select: { order: { select: { client: { select: { userId: true } } } } },
  });
  if (vault) {
    if (vault.order.client.userId !== requester.id && !isAdmin) {
      throw AppError.forbidden("Vous n'etes pas autorise a consulter ce document");
    }
    return privatePath;
  }

  const merchant = await prisma.merchant.findFirst({
    where: { OR: [{ cnibRectoUrl: filename }, { cnibVersoUrl: filename }] },
    select: { userId: true },
  });
  if (merchant) {
    if (merchant.userId !== requester.id && !isAdmin) {
      throw AppError.forbidden("Vous n'etes pas autorise a consulter ce document");
    }
    return privatePath;
  }

  throw AppError.notFound("Document introuvable");
}
