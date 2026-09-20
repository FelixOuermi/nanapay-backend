import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { authRateLimiter } from "@common/middleware/rateLimiter";
import { uploadPrivateDocument } from "@common/middleware/upload";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  recoverySchema,
  updateMeSchema,
} from "./auth.validation";
import * as authController from "./auth.controller";

export const authRouter = Router();
export const meRouter = Router();

const cnibUpload = uploadPrivateDocument.fields([
  { name: "cnibRecto", maxCount: 1 },
  { name: "cnibVerso", maxCount: 1 },
]);

// POST /auth/register : le role (CLIENT | MERCHANT) est dans le corps ; les anciens chemins
// dedies /register/client et /register/merchant fixent simplement ce champ.
const forceRole = (role: "CLIENT" | "MERCHANT") => (req: Request, _res: Response, next: NextFunction) => {
  req.body = { ...req.body, role };
  next();
};

authRouter.post("/register", authRateLimiter, cnibUpload, validate({ body: registerSchema }), asyncHandler(authController.register));
authRouter.post("/register/client", authRateLimiter, cnibUpload, forceRole("CLIENT"), validate({ body: registerSchema }), asyncHandler(authController.register));
authRouter.post("/register/merchant", authRateLimiter, cnibUpload, forceRole("MERCHANT"), validate({ body: registerSchema }), asyncHandler(authController.register));

authRouter.post("/login", authRateLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));
authRouter.post("/refresh", validate({ body: refreshSchema }), asyncHandler(authController.refresh));
authRouter.post("/logout", validate({ body: logoutSchema }), asyncHandler(authController.logout));
authRouter.post("/recovery", authRateLimiter, validate({ body: recoverySchema }), asyncHandler(authController.recovery));

meRouter.use(requireAuth);
meRouter.get("/", asyncHandler(authController.getMe));
meRouter.patch("/", validate({ body: updateMeSchema }), asyncHandler(authController.updateMe));
