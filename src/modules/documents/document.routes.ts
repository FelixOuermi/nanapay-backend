import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { documentFilenameParamSchema } from "./document.validation";
import * as documentController from "./document.controller";

// Documents prives (CNIB, bulletins, autorisation de prelevement) : jamais servis
// statiquement (contrairement a /media pour les photos produits). Accessible a tout
// role authentifie, l'autorisation fine (proprietaire / Admin / Banque assignee) est
// verifiee dans document.service.ts.
export const documentRouter = Router();

documentRouter.get(
  "/:filename",
  requireAuth,
  validate({ params: documentFilenameParamSchema }),
  asyncHandler(documentController.getDocument)
);
