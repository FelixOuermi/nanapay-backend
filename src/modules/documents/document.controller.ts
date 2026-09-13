import path from "node:path";
import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import { resolvePrivateDocumentPath } from "./document.service";

export async function getDocument(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const relativePath = await resolvePrivateDocumentPath(req.params.filename, req.user);
  res.sendFile(path.resolve(process.cwd(), relativePath));
}
