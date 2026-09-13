import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as authService from "./auth.service";

interface UploadedFiles {
  cnibRecto?: Express.Multer.File[];
  cnibVerso?: Express.Multer.File[];
}

function requireCnibFiles(files: unknown): { cnibRectoUrl: string; cnibVersoUrl: string } {
  const { cnibRecto, cnibVerso } = (files ?? {}) as UploadedFiles;

  if (!cnibRecto?.[0] || !cnibVerso?.[0]) {
    throw AppError.badRequest("Les photos recto et verso de la CNIB sont requises");
  }

  // On stocke le nom de fichier seul (pas le chemin complet, dependant de l'OS) : la
  // destination est fixe par la config d'upload et reconstituee au moment de servir
  // le fichier via un endpoint controle (cf. modules/documents).
  return { cnibRectoUrl: cnibRecto[0].filename, cnibVersoUrl: cnibVerso[0].filename };
}

export async function registerClient(req: Request, res: Response): Promise<void> {
  const { cnibRectoUrl, cnibVersoUrl } = requireCnibFiles(req.files);

  const result = await authService.registerClient({ ...req.body, cnibRectoUrl, cnibVersoUrl });
  res.status(201).json(result);
}

export async function registerMerchant(req: Request, res: Response): Promise<void> {
  const { cnibRectoUrl, cnibVersoUrl } = requireCnibFiles(req.files);

  const result = await authService.registerMerchant({ ...req.body, cnibRectoUrl, cnibVersoUrl });
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  res.status(200).json(result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken);
  res.status(200).json(result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  res.status(204).send();
}

export async function recovery(req: Request, res: Response): Promise<void> {
  const { email } = req.body;
  await authService.requestAccountRecovery(email);
  res.status(200).json({ message: "Si un compte existe avec cet e-mail, des instructions ont ete envoyees" });
}
