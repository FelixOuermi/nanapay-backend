import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import path from "node:path";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "@common/middleware/errorHandler";
import { requestId } from "@common/middleware/requestId";
import { env } from "@config/env";
import { openApiSpec } from "@config/openapi";

// CORS configure pour le domaine du frontend (CORS_ORIGIN, liste separee par des virgules).
function corsOptions(): cors.CorsOptions {
  if (env.CORS_ORIGIN === "*") {
    return {};
  }
  const allowed = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
  return {
    origin: allowed,
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
  };
}

export function createApp() {
  const app = express();

  // Derriere le proxy Render : necessaire pour que le rate limiting voie la vraie IP client.
  app.set("trust proxy", 1);

  app.use(requestId);
  app.use(helmet());
  app.use(cors(corsOptions()));
  app.use(
    express.json({
      limit: "1mb",
      // Corps brut conserve : la signature HMAC des webhooks (X-Signature) est calculee dessus.
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Medias publics uniquement (photos de produits, spots publicitaires) : les documents
  // prives (uploads/private) ne sont jamais servis statiquement, cf. modules/documents.
  app.use("/media", express.static(path.join(process.cwd(), env.UPLOAD_DIR, "public")));

  // Documentation OpenAPI. CSP de helmet desactivee uniquement sur cette route :
  // swagger-ui-dist a besoin de scripts/styles inline pour s'afficher.
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

  app.use("/api", apiRouter);
  app.use("/api/v1", apiRouter); // alias historique

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
