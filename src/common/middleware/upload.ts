import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@config/env";
import { AppError } from "@common/errors/AppError";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Pieces justificatives (CNIB, bulletins de salaire, autorisations de prelevement) : image ou PDF.
const DOCUMENT_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, "application/pdf"]);

function makeUploader(subdir: string, allowedMimeTypes: Set<string>) {
  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, path.join(env.UPLOAD_DIR, subdir)),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${randomUUID()}${extension}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (!allowedMimeTypes.has(file.mimetype)) {
        callback(AppError.unprocessable(`Type de fichier non autorise: ${file.mimetype}`));
        return;
      }
      callback(null, true);
    },
  });
}

/**
 * Documents prives (CNIB, bulletins de salaire, autorisations de prelevement) : stockes
 * hors de toute route servie statiquement, jamais exposes publiquement (cf. section 14,
 * "acces controle"). A servir plus tard via un endpoint dedie qui verifie l'autorisation
 * (Admin / Banque / proprietaire du dossier) avant de renvoyer le fichier.
 */
export const uploadPrivateDocument = makeUploader("private", DOCUMENT_MIME_TYPES);

/**
 * Medias publics (photos d'articles, spots publicitaires) : ces visuels doivent au
 * contraire etre visibles par tous les clients sur le Market, donc serves statiquement
 * (voir app.ts, route /media).
 */
export const uploadPublicMedia = makeUploader("public", IMAGE_MIME_TYPES);
