import { Request, Response, NextFunction } from "express";
import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { asyncHandler } from "@common/utils/asyncHandler";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Protege les endpoints repetables (webhooks Mobile Money, virements, actions admin
 * critiques) contre les doublons. Le client/fournisseur doit envoyer un en-tete
 * Idempotency-Key ; si une reponse existe deja pour cette cle+scope, elle est
 * rejouee telle quelle sans re-executer la logique metier.
 *
 * Enveloppe dans asyncHandler : sans cela, une erreur levee dans ce middleware async
 * (Idempotency-Key manquant, erreur DB transitoire) devient une promesse rejetee non
 * geree par Express 4, qui ne se contente pas d'echouer la requete mais fait planter
 * tout le process Node (Node >= 15 termine le process sur un unhandledRejection).
 */
export function idempotent(scope: string) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("Idempotency-Key");

    if (!key) {
      throw AppError.badRequest("En-tete Idempotency-Key requis pour cette operation");
    }

    const existing = await prisma.idempotencyKey.findUnique({ where: { key } });

    if (existing && existing.scope === scope) {
      res.status(existing.statusCode ?? 200).json(existing.responseBody ?? {});
      return;
    }

    const originalJson = res.json.bind(res);

    res.json = ((body: unknown) => {
      prisma.idempotencyKey
        .upsert({
          where: { key },
          create: {
            key,
            scope,
            statusCode: res.statusCode,
            responseBody: body as object,
            expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
          },
          update: {
            statusCode: res.statusCode,
            responseBody: body as object,
          },
        })
        .catch(() => {
          // La persistance de la cle ne doit jamais faire echouer la reponse deja envoyee.
        });

      return originalJson(body);
    }) as typeof res.json;

    next();
  });
}
