import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { uploadPrivateDocument } from "@common/middleware/upload";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendData } from "@common/utils/response";
import { clientId } from "@modules/orders/order.routes";
import * as vaultService from "./vault.service";

// Monte a la racine de l'API : /orders/:id/vault et /vaults/*.
export const vaultRouter = Router();

const clientOnly = [requireAuth, requireRole("CLIENT")];
const idParam = z.object({ id: z.string().min(1) });
const createBody = z.object({ durationMonths: z.coerce.number().int().positive() });

vaultRouter.post(
  "/orders/:id/vault",
  ...clientOnly,
  sensitiveActionRateLimiter,
  uploadPrivateDocument.fields([{ name: "salaryDebitAuthorization", maxCount: 1 }]),
  validate({ params: idParam, body: createBody }),
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files ?? {}) as { salaryDebitAuthorization?: Express.Multer.File[] };
    const vault = await vaultService.createVault(
      clientId(req),
      req.params.id,
      req.body.durationMonths,
      files.salaryDebitAuthorization?.[0]?.filename
    );
    sendData(res, vault, 201);
  })
);

vaultRouter.get("/vaults/:id", ...clientOnly, validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => sendData(res, await vaultService.getVault(clientId(req), req.params.id))));
vaultRouter.post("/vaults/:id/use", ...clientOnly, sensitiveActionRateLimiter, validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => sendData(res, await vaultService.useVault(clientId(req), req.params.id))));
vaultRouter.post(
  "/vaults/:id/switch-to-credit",
  ...clientOnly,
  sensitiveActionRateLimiter,
  validate({ params: idParam, body: createBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await vaultService.switchToCredit(clientId(req), req.params.id, req.body.durationMonths), 201)
  )
);
