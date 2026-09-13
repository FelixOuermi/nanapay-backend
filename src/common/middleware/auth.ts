import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "@config/env";
import { AppError } from "@common/errors/AppError";
import { UserRole } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string; // userId
  role: UserRole;
  clientId?: string;
  merchantId?: string;
}

// Verifie le JWT d'acces et attache l'utilisateur authentifie a req.user.
// Chaque endpoint protege doit passer par ce middleware avant toute logique metier
// (le RBAC et la verification de propriete se font ensuite dans requireRole / le controleur).
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw AppError.unauthorized("Token d'acces manquant");
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    req.user = {
      id: payload.sub,
      role: payload.role,
      clientId: payload.clientId,
      merchantId: payload.merchantId,
    };
    next();
  } catch {
    throw AppError.unauthorized("Token d'acces invalide ou expire");
  }
}
