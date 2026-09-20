import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { paginationQuerySchema, sendData, sendPage } from "@common/utils/response";
import { clientId } from "@modules/orders/order.routes";
import * as savingsService from "./savings.service";

// Monte a la racine de l'API : /orders/:id/savings et /savings/*.
export const savingsRouter = Router();

const clientOnly = [requireAuth, requireRole("CLIENT")];
const idParam = z.object({ id: z.string().min(1) });
const createSavingsBody = z.object({ durationMonths: z.number().int().positive().optional() });
const extensionBody = z.object({ months: z.number().int().min(1).max(2) });

savingsRouter.post(
  "/orders/:id/savings",
  ...clientOnly,
  validate({ params: idParam, body: createSavingsBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await savingsService.createSavings(clientId(req), req.params.id, req.body.durationMonths), 201)
  )
);

savingsRouter.get(
  "/savings/:id",
  ...clientOnly,
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await savingsService.getSavings(clientId(req), req.params.id)))
);

savingsRouter.get(
  "/savings/:id/history",
  ...clientOnly,
  validate({ params: idParam, query: paginationQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { items, total } = await savingsService.getSavingsHistory(clientId(req), req.params.id, { page, limit });
    sendPage(res, items, { page, limit }, total);
  })
);

savingsRouter.post(
  "/savings/:id/extension",
  ...clientOnly,
  validate({ params: idParam, body: extensionBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await savingsService.extendSavings(clientId(req), req.params.id, req.body.months))
  )
);
