import { Request, Response, Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { AppError } from "@common/errors/AppError";
import { sendData, sendPage } from "@common/utils/response";
import { createOrderSchema, selectFinancingSchema, listOrdersQuerySchema, orderIdParamSchema } from "./order.validation";
import * as orderService from "./order.service";

export const orderRouter = Router();

orderRouter.use(requireAuth, requireRole("CLIENT"));

export function clientId(req: Request): string {
  if (!req.user?.clientId) {
    throw AppError.unauthorized();
  }
  return req.user.clientId;
}

orderRouter.post(
  "/",
  validate({ body: createOrderSchema }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await orderService.createOrder(clientId(req), req.body.productId), 201))
);

orderRouter.get(
  "/",
  validate({ query: listOrdersQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status } = req.query as unknown as { page: number; limit: number; status?: never };
    const { items, total } = await orderService.listOrders(clientId(req), { page, limit }, status);
    sendPage(res, items, { page, limit }, total);
  })
);

orderRouter.get(
  "/:id",
  validate({ params: orderIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await orderService.getOrderDetail(clientId(req), req.params.id)))
);

orderRouter.post(
  "/:id/select-financing",
  validate({ params: orderIdParamSchema, body: selectFinancingSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await orderService.selectFinancing(clientId(req), req.params.id, req.body.mode))
  )
);

orderRouter.get(
  "/:id/qr",
  validate({ params: orderIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await orderService.getOrderQr(clientId(req), req.params.id)))
);
