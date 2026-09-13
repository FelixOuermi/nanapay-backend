import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "@common/errors/AppError";

// RBAC strict : a utiliser apres requireAuth. Ne verifie que le role ; la propriete
// de la ressource (ex: un client ne peut lire que SES commandes) doit toujours etre
// controlee explicitement dans le service/controleur concerne.
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw AppError.forbidden(`Role ${req.user.role} non autorise pour cette ressource`);
    }

    next();
  };
}
