import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { uploadPrivateDocument } from "@common/middleware/upload";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { AppError } from "@common/errors/AppError";
import { sendData } from "@common/utils/response";
import { clientId } from "@modules/orders/order.routes";
import * as creditService from "./credit.service";

// Monte a la racine de l'API : /credit/* et /credits/:id.
export const creditRouter = Router();

const clientOnly = [requireAuth, requireRole("CLIENT")];
const idParam = z.object({ id: z.string().min(1) });

const profileBody = z.object({
  employer: z.string().min(1),
  registrationNumber: z.string().min(1).optional(),
});

const requestBody = z.object({
  orderId: z.string().min(1),
  durationMonths: z.coerce.number().int().positive(),
});

creditRouter.get("/credit/profile", ...clientOnly, asyncHandler(async (req: Request, res: Response) => sendData(res, await creditService.getCreditProfile(clientId(req)))));

// Documents bancaires stockes de facon privee (multipart) : autorisation de prelevement + bulletins.
creditRouter.post(
  "/credit/profile",
  ...clientOnly,
  sensitiveActionRateLimiter,
  uploadPrivateDocument.fields([
    { name: "bankAuthorization", maxCount: 1 },
    { name: "paySlips", maxCount: 1 },
  ]),
  validate({ body: profileBody }),
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files ?? {}) as { bankAuthorization?: Express.Multer.File[]; paySlips?: Express.Multer.File[] };
    if (!files.bankAuthorization?.[0] || !files.paySlips?.[0]) {
      throw AppError.badRequest("Autorisation de prelevement et bulletins de salaire requis");
    }
    const profile = await creditService.submitCreditProfile(clientId(req), req.user!.id, {
      ...req.body,
      bankAuthorizationUrl: files.bankAuthorization[0].filename,
      paySlipsUrl: files.paySlips[0].filename,
    });
    sendData(res, profile, 201);
  })
);

creditRouter.post(
  "/credit/requests",
  ...clientOnly,
  sensitiveActionRateLimiter,
  validate({ body: requestBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await creditService.createCreditRequest(clientId(req), req.body.orderId, req.body.durationMonths), 201)
  )
);

creditRouter.get("/credit/requests/:id", ...clientOnly, validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => sendData(res, await creditService.getCreditRequest(clientId(req), req.params.id))));
creditRouter.get("/credits/:id", ...clientOnly, validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => sendData(res, await creditService.getCredit(clientId(req), req.params.id))));
