import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { idempotent } from "@common/middleware/idempotency";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { bankCreditIdParamSchema, rejectCreditSchema } from "./bank.validation";
import * as bankController from "./bank.controller";

export const bankRouter = Router();

bankRouter.use(requireAuth, requireRole("BANQUE"));

bankRouter.get("/credit-requests", asyncHandler(bankController.listCreditRequests));
bankRouter.get(
  "/credit-requests/:id",
  validate({ params: bankCreditIdParamSchema }),
  asyncHandler(bankController.getCreditRequest)
);
bankRouter.post(
  "/credit-requests/:id/approve",
  sensitiveActionRateLimiter,
  validate({ params: bankCreditIdParamSchema }),
  asyncHandler(bankController.approveCreditRequest)
);
bankRouter.post(
  "/credit-requests/:id/reject",
  sensitiveActionRateLimiter,
  validate({ params: bankCreditIdParamSchema, body: rejectCreditSchema }),
  asyncHandler(bankController.rejectCreditRequest)
);
bankRouter.post(
  "/transfers/:id/execute",
  sensitiveActionRateLimiter,
  idempotent("bank-transfer-execute"),
  validate({ params: bankCreditIdParamSchema }),
  asyncHandler(bankController.executeTransfer)
);
