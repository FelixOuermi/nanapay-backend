import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { asyncHandler } from "@common/utils/asyncHandler";
import * as clientController from "./client.controller";
import { getClientSavings } from "@modules/savings/savings.controller";

export const clientRouter = Router();

clientRouter.use(requireAuth, requireRole("CLIENT"));

clientRouter.get("/profile", asyncHandler(clientController.getProfile));
clientRouter.get("/savings", asyncHandler(getClientSavings));
clientRouter.get("/notifications", asyncHandler(clientController.getNotifications));
