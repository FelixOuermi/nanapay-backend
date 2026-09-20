import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { Prisma } from "@prisma/client";
import { AppError } from "@common/errors/AppError";
import { logger } from "@config/logger";

// Contrat d'erreur : { code, message, details?, requestId } (cahier, section 8).
function sendError(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ code, message, details, requestId: req.requestId });
}

export function notFoundHandler(req: Request, res: Response) {
  sendError(req, res, 404, "NOT_FOUND", `Route introuvable: ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    sendError(req, res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err instanceof MulterError) {
    sendError(req, res, 400, "UPLOAD_ERROR", err.message);
    return;
  }

  if (err instanceof ZodError) {
    sendError(req, res, 422, "VALIDATION_ERROR", "Donnees invalides", err.flatten());
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    sendError(req, res, 409, "CONFLICT", "Cette ressource existe deja");
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    sendError(req, res, 400, "BAD_REQUEST", "Corps JSON invalide");
    return;
  }

  logger.error("Erreur non geree", { error: err, requestId: req.requestId });
  sendError(req, res, 500, "INTERNAL_ERROR", "Erreur interne du serveur");
}
