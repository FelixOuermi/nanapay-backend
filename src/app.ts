import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import path from "node:path";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "@common/middleware/errorHandler";
import { env } from "@config/env";
import { openApiSpec } from "@config/openapi";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Medias publics uniquement (photos d'articles, spots publicitaires) : les documents
  // KYC (uploads/private) ne sont jamais servis statiquement, cf. common/middleware/upload.ts.
  app.use("/media", express.static(path.join(process.cwd(), env.UPLOAD_DIR, "public")));

  // Documentation API (cahier des taches, section 16 : "Une API documentee... le
  // Backend fournit au Front-end un document API avec endpoint, methode, parametres,
  // exemple de requete/reponse, codes d'erreur et droits requis"). CSP de helmet
  // desactivee uniquement sur cette route : swagger-ui-dist a besoin de scripts/styles
  // inline pour s'afficher, le reste de l'API garde la CSP stricte par defaut.
  app.get("/api-docs.json", (_req, res) => res.json(openApiSpec));
  app.use(
    "/api-docs",
    (_req: Request, res: Response, next: NextFunction) => {
      res.removeHeader("Content-Security-Policy");
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec)
  );

  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
