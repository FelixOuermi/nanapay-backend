import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { paginationQuerySchema, sendData, sendPage } from "@common/utils/response";
import { financialParamsPatchSchema } from "@services/financial/settingsService";
import * as adminService from "./admin.service";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("ADMIN"));

const idParam = z.object({ id: z.string().min(1) });
const statusBody = z.object({ status: z.enum(["VALIDE", "SUSPENDU"]), reason: z.string().max(500).optional() });
const clientStatusBody = z.object({ status: z.enum(["ACTIF", "SUSPENDU"]), reason: z.string().max(500).optional() });
const refundBody = z.object({ reference: z.string().min(3).max(100).optional() });
const paidBody = z.object({ reference: z.string().min(3).max(100) });

const page = (req: Request) => {
  const { page: p, limit } = req.query as unknown as { page: number; limit: number };
  return { page: p, limit };
};

adminRouter.get("/dashboard", asyncHandler(async (_req: Request, res: Response) => sendData(res, await adminService.getDashboard())));

// --- Comptes ---
adminRouter.get(
  "/clients",
  validate({ query: paginationQuerySchema.extend({ status: z.enum(["ACTIF", "SUSPENDU"]).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { items, total } = await adminService.listClients(page(req), req.query.status as never);
    sendPage(res, items, page(req), total);
  })
);
adminRouter.patch(
  "/clients/:id/status",
  sensitiveActionRateLimiter,
  validate({ params: idParam, body: clientStatusBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await adminService.setClientStatus(req.user!.id, req.params.id, req.body.status, req.body.reason))
  )
);

adminRouter.get(
  "/merchants",
  validate({ query: paginationQuerySchema.extend({ status: z.enum(["EN_ATTENTE", "VALIDE", "SUSPENDU"]).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { items, total } = await adminService.listMerchants(page(req), req.query.status as never);
    sendPage(res, items, page(req), total);
  })
);
adminRouter.patch(
  "/merchants/:id/status",
  sensitiveActionRateLimiter,
  validate({ params: idParam, body: statusBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await adminService.setMerchantStatus(req.user!.id, req.params.id, req.body.status, req.body.reason))
  )
);

// --- Supervision ---
adminRouter.get("/savings", validate({ query: paginationQuerySchema }), asyncHandler(async (req: Request, res: Response) => {
  const { items, total } = await adminService.listSavings(page(req));
  sendPage(res, items, page(req), total);
}));
adminRouter.post(
  "/savings/:id/refund",
  sensitiveActionRateLimiter,
  validate({ params: idParam, body: refundBody }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await adminService.refundSavings(req.user!.id, req.params.id, req.body.reference)))
);

adminRouter.get("/credits", validate({ query: paginationQuerySchema }), asyncHandler(async (req: Request, res: Response) => {
  const { items, total } = await adminService.listCredits(page(req));
  sendPage(res, items, page(req), total);
}));

adminRouter.get(
  "/payments",
  validate({
    query: paginationQuerySchema.extend({
      status: z.enum(["INITIE", "EN_ATTENTE", "CONFIRME", "ECHOUE"]).optional(),
      orderId: z.string().min(1).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, orderId } = req.query as unknown as { status?: never; orderId?: string };
    const { items, total } = await adminService.listPayments(page(req), { status, orderId });
    sendPage(res, items, page(req), total);
  })
);

adminRouter.get(
  "/audit-logs",
  validate({
    query: paginationQuerySchema.extend({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      action: z.string().optional(),
      userId: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { entityType, entityId, action, userId, from, to } = req.query as unknown as Record<string, never>;
    const { items, total } = await adminService.listAuditLogs(page(req), { entityType, entityId, action, userId, from, to });
    sendPage(res, items, page(req), total);
  })
);

// --- Reglements commercants ---
adminRouter.get(
  "/settlements",
  validate({ query: paginationQuerySchema.extend({ status: z.enum(["EN_ATTENTE", "PAYE"]).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { items, total } = await adminService.listSettlements(page(req), req.query.status as never);
    sendPage(res, items, page(req), total);
  })
);
adminRouter.post(
  "/settlements/:id/paid",
  sensitiveActionRateLimiter,
  validate({ params: idParam, body: paidBody }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await adminService.markSettlementPaid(req.user!.id, req.params.id, req.body.reference)))
);

// --- Parametres financiers configurables ---
adminRouter.get("/settings/financial", asyncHandler(async (_req: Request, res: Response) => sendData(res, await adminService.getFinancialSettings())));
adminRouter.patch(
  "/settings/financial",
  sensitiveActionRateLimiter,
  validate({ body: financialParamsPatchSchema }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await adminService.patchFinancialSettings(req.user!.id, req.body)))
);
