import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as bankCreditService from "./bankCredit.service";

interface DossierFiles {
  bankAuthorization?: Express.Multer.File[];
  paySlips?: Express.Multer.File[];
}

function requireClientId(req: Request): string {
  if (!req.user?.clientId) {
    throw AppError.unauthorized();
  }
  return req.user.clientId;
}

export async function submitDossier(req: Request, res: Response): Promise<void> {
  const clientId = requireClientId(req);
  const { bankAuthorization, paySlips } = (req.files ?? {}) as DossierFiles;

  // Une soumission (par opposition a une simple reutilisation du dossier existant) doit
  // arriver complete : les deux fichiers ET l'employeur. Sinon on laisse le service
  // decider (reutilisation si deja au dossier, sinon erreur explicite "dossier requis").
  const isSubmission = Boolean(bankAuthorization?.[0] && paySlips?.[0] && req.body.employer);

  const result = await bankCreditService.submitOrReuseDossier(
    clientId,
    req.params.id,
    isSubmission
      ? {
          employer: req.body.employer,
          registrationNumber: req.body.registrationNumber,
          // Nom de fichier seul (voir auth.controller.ts pour la justification).
          bankAuthorizationUrl: bankAuthorization![0].filename,
          paySlipsUrl: paySlips![0].filename,
        }
      : undefined
  );

  res.status(200).json(result);
}

export async function setTerms(req: Request, res: Response): Promise<void> {
  const clientId = requireClientId(req);
  const bankCredit = await bankCreditService.setBankCreditTerms(clientId, req.params.id, req.body.months);
  res.status(201).json(bankCredit);
}
