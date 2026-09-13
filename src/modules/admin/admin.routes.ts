import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { idempotent } from "@common/middleware/idempotency";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { idParamSchema, rejectAccountSchema } from "./admin.validation";
import * as adminController from "./admin.controller";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("ADMIN"));

adminRouter.get("/clients/pending", asyncHandler(adminController.listPendingClients));
adminRouter.post(
  "/clients/:id/approve",
  sensitiveActionRateLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(adminController.approveClient)
);
adminRouter.post(
  "/clients/:id/reject",
  sensitiveActionRateLimiter,
  validate({ params: idParamSchema, body: rejectAccountSchema }),
  asyncHandler(adminController.rejectClient)
);

adminRouter.get("/merchants/pending", asyncHandler(adminController.listPendingMerchants));
adminRouter.post(
  "/merchants/:id/approve",
  sensitiveActionRateLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(adminController.approveMerchant)
);
adminRouter.post(
  "/merchants/:id/reject",
  sensitiveActionRateLimiter,
  validate({ params: idParamSchema, body: rejectAccountSchema }),
  asyncHandler(adminController.rejectMerchant)
);

adminRouter.get("/savings", asyncHandler(adminController.listSavings));
adminRouter.get("/credits", asyncHandler(adminController.listCredits));
adminRouter.post(
  "/credits/:id/payout",
  sensitiveActionRateLimiter,
  idempotent("admin-credit-payout"),
  validate({ params: idParamSchema }),
  asyncHandler(adminController.processCreditPayout)
);

adminRouter.get("/transactions", asyncHandler(adminController.listTransactions));
adminRouter.get("/notifications", asyncHandler(adminController.listNotifications));
