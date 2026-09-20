import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { documentFilenameParamSchema, temporaryTokenParamSchema } from "./document.validation";
import * as documentController from "./document.controller";

// Documents prives (CNIB, bulletins, autorisation de prelevement) : jamais servis
// statiquement. Acces direct authentifie, ou via une URL temporaire signee (quelques
// minutes) quand le document doit etre expose a un composant qui ne peut pas envoyer
// l'en-tete Authorization (balise <img>, telechargement). L'autorisation fine
// (proprietaire / Admin / Banque assignee) est verifiee dans document.service.ts.
export const documentRouter = Router();

// Declare avant "/:filename" : "temp" ne doit pas etre pris pour un nom de fichier.
documentRouter.get("/temp/:token", validate({ params: temporaryTokenParamSchema }), asyncHandler(documentController.getTemporaryDocument));

documentRouter.post(
  "/:filename/temporary-url",
  requireAuth,
  validate({ params: documentFilenameParamSchema }),
  asyncHandler(documentController.createTemporaryUrl)
);

documentRouter.get(
  "/:filename",
  requireAuth,
  validate({ params: documentFilenameParamSchema }),
  asyncHandler(documentController.getDocument)
);
