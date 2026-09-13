import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { uploadPrivateDocument } from "@common/middleware/upload";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { createOrderSchema, extendSavingsSchema, orderIdParamSchema } from "./order.validation";
import * as orderController from "./order.controller";
import * as bankCreditController from "@modules/bankCredits/bankCredit.controller";
import { submitDossierSchema, bankCreditTermsSchema } from "@modules/bankCredits/bankCredit.validation";

export const orderRouter = Router();

orderRouter.use(requireAuth, requireRole("CLIENT"));

orderRouter.post("/", validate({ body: createOrderSchema }), asyncHandler(orderController.createOrder));
orderRouter.get("/:id", validate({ params: orderIdParamSchema }), asyncHandler(orderController.getOrder));
orderRouter.post(
  "/:id/savings/extend",
  validate({ params: orderIdParamSchema, body: extendSavingsSchema }),
  asyncHandler(orderController.extendSavings)
);
orderRouter.post(
  "/:id/bank-credit",
  sensitiveActionRateLimiter,
  uploadPrivateDocument.fields([
    { name: "bankAuthorization", maxCount: 1 },
    { name: "paySlips", maxCount: 1 },
  ]),
  validate({ params: orderIdParamSchema, body: submitDossierSchema }),
  asyncHandler(bankCreditController.submitDossier)
);
orderRouter.post(
  "/:id/bank-credit/terms",
  sensitiveActionRateLimiter,
  validate({ params: orderIdParamSchema, body: bankCreditTermsSchema }),
  asyncHandler(bankCreditController.setTerms)
);
orderRouter.get(
  "/:id/qr",
  validate({ params: orderIdParamSchema }),
  asyncHandler(orderController.getOrderQrCode)
);
