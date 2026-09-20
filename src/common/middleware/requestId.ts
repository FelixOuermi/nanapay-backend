import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

// Attache un identifiant de requete (repris de X-Request-Id s'il est fourni, sinon genere)
// a req.requestId et a l'en-tete de reponse. Il est renvoye dans chaque erreur
// { code, message, details?, requestId } pour faciliter le support cote frontend.
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("X-Request-Id");
  const id = incoming && /^[\w.-]{8,100}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
