import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import { sendData } from "@common/utils/response";
import * as authService from "./auth.service";

interface UploadedFiles {
  cnibRecto?: Express.Multer.File[];
  cnibVerso?: Express.Multer.File[];
}

// On stocke le nom de fichier seul : la destination est fixe par la config d'upload et
// reconstituee au moment de servir le fichier via un endpoint controle (modules/documents).
function requireCnibFiles(files: unknown): { cnibRectoUrl: string; cnibVersoUrl: string } {
  const { cnibRecto, cnibVerso } = (files ?? {}) as UploadedFiles;

  if (!cnibRecto?.[0] || !cnibVerso?.[0]) {
    throw AppError.badRequest("Les photos recto et verso de la CNIB sont requises");
  }

  return { cnibRectoUrl: cnibRecto[0].filename, cnibVersoUrl: cnibVerso[0].filename };
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body, requireCnibFiles(req.files));
  sendData(res, result, 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  sendData(res, await authService.login(req.body.email, req.body.password));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  sendData(res, await authService.refresh(req.body.refreshToken));
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.body.refreshToken);
  res.status(204).send();
}

export async function recovery(req: Request, res: Response): Promise<void> {
  await authService.requestAccountRecovery(req.body.email);
  sendData(res, { message: "Si un compte existe avec cet e-mail, des instructions ont ete envoyees" });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  sendData(res, await authService.getMe(req.user!.id));
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  sendData(res, await authService.updateMe(req.user!.id, req.user!.role, req.body));
}
