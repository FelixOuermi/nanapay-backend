import path from "node:path";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "@config/env";
import { AppError } from "@common/errors/AppError";
import { sendData } from "@common/utils/response";
import { resolvePrivateDocumentPath } from "./document.service";

const TEMP_URL_TTL_SECONDS = 300;

// Secret derive : un jeton d'acces ne peut pas etre rejoue comme jeton de document (et inversement).
const documentSecret = () => `${env.JWT_ACCESS_SECRET}:document-link`;

export async function getDocument(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const relativePath = await resolvePrivateDocumentPath(req.params.filename, req.user);
  res.sendFile(path.resolve(process.cwd(), relativePath));
}

/** URL temporaire (5 min) : l'autorisation est verifiee a la creation du lien. */
export async function createTemporaryUrl(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  await resolvePrivateDocumentPath(req.params.filename, req.user);
  const token = jwt.sign({ f: req.params.filename }, documentSecret(), { expiresIn: TEMP_URL_TTL_SECONDS });
  const expiresAt = new Date(Date.now() + TEMP_URL_TTL_SECONDS * 1000);

  sendData(res, { url: `${env.APP_URL}/api/documents/temp/${token}`, expiresAt });
}

export async function getTemporaryDocument(req: Request, res: Response): Promise<void> {
  let filename: string;
  try {
    const payload = jwt.verify(req.params.token, documentSecret()) as { f: string };
    filename = payload.f;
  } catch {
    throw AppError.unauthorized("Lien temporaire invalide ou expire");
  }

  res.sendFile(path.resolve(process.cwd(), env.UPLOAD_DIR, "private", path.basename(filename)));
}
