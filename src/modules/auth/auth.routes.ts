import { Router } from "express";
import { authRateLimiter } from "@common/middleware/rateLimiter";
import { uploadPrivateDocument } from "@common/middleware/upload";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import {
  registerClientSchema,
  registerMerchantSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  recoverySchema,
} from "./auth.validation";
import * as authController from "./auth.controller";

export const authRouter = Router();

const cnibUpload = uploadPrivateDocument.fields([
  { name: "cnibRecto", maxCount: 1 },
  { name: "cnibVerso", maxCount: 1 },
]);

authRouter.post(
  "/register/client",
  authRateLimiter,
  cnibUpload,
  validate({ body: registerClientSchema }),
  asyncHandler(authController.registerClient)
);

authRouter.post(
  "/register/merchant",
  authRateLimiter,
  cnibUpload,
  validate({ body: registerMerchantSchema }),
  asyncHandler(authController.registerMerchant)
);

authRouter.post("/login", authRateLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));

authRouter.post("/refresh", validate({ body: refreshSchema }), asyncHandler(authController.refresh));

authRouter.post("/logout", validate({ body: logoutSchema }), asyncHandler(authController.logout));

authRouter.post(
  "/recovery",
  authRateLimiter,
  validate({ body: recoverySchema }),
  asyncHandler(authController.recovery)
);
