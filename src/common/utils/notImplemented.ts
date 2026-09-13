import { Request, Response } from "express";

/**
 * Placeholder pour les endpoints dont le contrat (route + RBAC) est fixe par
 * l'architecture mais dont la logique metier sera implementee module par module.
 * A remplacer par le vrai controleur au fur et a mesure du developpement.
 */
export function notImplemented(endpointName: string) {
  return (_req: Request, res: Response) => {
    res.status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: `${endpointName} n'est pas encore implemente`,
      },
    });
  };
}
