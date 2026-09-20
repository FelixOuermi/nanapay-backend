import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { AppError } from "@common/errors/AppError";
import { paginationQuerySchema, sendData, sendPage } from "@common/utils/response";
import * as bankService from "./bank.service";
import * as creditService from "@modules/credit/credit.service";

export const bankRouter = Router();

bankRouter.use(requireAuth, requireRole("BANK"));

function bankId(req: Request): string {
  if (!req.user?.bankId) {
    throw AppError.unauthorized();
  }
  return req.user.bankId;
}

const idParam = z.object({ id: z.string().min(1) });
const profilesQuery = paginationQuerySchema.extend({
  status: z.enum(["NON_CONFIGURE", "EN_ANALYSE", "VALIDE", "REFUSE"]).optional(),
});
const requestsQuery = paginationQuerySchema.extend({
  status: z.enum(["BROUILLON", "ENVOYEE", "EN_ANALYSE", "ACCEPTEE", "REFUSEE"]).optional(),
});
const profileDecisionBody = z.object({ decision: z.enum(["VALIDE", "REFUSE"]), reason: z.string().max(500).optional() });
const requestDecisionBody = z.object({ decision: z.enum(["ACCEPTEE", "REFUSEE"]), reason: z.string().max(500).optional() });
const transferNoticeBody = z.object({
  creditId: z.string().min(1),
  transferReference: z.string().min(3).max(100),
  amount: z.number().int().positive(),
});

bankRouter.get(
  "/credit-profiles",
  validate({ query: profilesQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status } = req.query as unknown as { page: number; limit: number; status?: never };
    const { items, total } = await bankService.listCreditProfiles(bankId(req), { page, limit }, status);
    sendPage(res, items, { page, limit }, total);
  })
);

bankRouter.patch(
  "/credit-profiles/:id/decision",
  sensitiveActionRateLimiter,
  validate({ params: idParam, body: profileDecisionBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await bankService.decideCreditProfile(bankId(req), req.user!.id, req.params.id, req.body.decision, req.body.reason))
  )
);

bankRouter.get(
  "/credit-requests",
  validate({ query: requestsQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status } = req.query as unknown as { page: number; limit: number; status?: never };
    const { items, total } = await bankService.listCreditRequests(bankId(req), { page, limit }, status);
    sendPage(res, items, { page, limit }, total);
  })
);

bankRouter.patch(
  "/credit-requests/:id/decision",
  sensitiveActionRateLimiter,
  validate({ params: idParam, body: requestDecisionBody }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await creditService.decideCreditRequest(bankId(req), req.params.id, req.body.decision, req.body.reason, req.user!.id))
  )
);

bankRouter.post(
  "/transfers/notice",
  sensitiveActionRateLimiter,
  validate({ body: transferNoticeBody }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await bankService.noticeTransfer(bankId(req), req.user!.id, req.body), 201))
);
