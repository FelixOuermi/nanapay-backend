import { Request, Response, Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { uploadPublicMedia } from "@common/middleware/upload";
import { sensitiveActionRateLimiter } from "@common/middleware/rateLimiter";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { AppError } from "@common/errors/AppError";
import { paginationQuerySchema, sendData, sendPage } from "@common/utils/response";
import {
  storeSchema,
  createProductSchema,
  updateProductSchema,
  productIdParamSchema,
  listMerchantOrdersQuerySchema,
  scanQrSchema,
  orderIdParamSchema,
} from "./merchant.validation";
import * as merchantService from "./merchant.service";
import * as withdrawalService from "@modules/withdrawals/withdrawal.service";

export const merchantRouter = Router();

merchantRouter.use(requireAuth, requireRole("MERCHANT"));

function merchantId(req: Request): string {
  if (!req.user?.merchantId) {
    throw AppError.unauthorized();
  }
  return req.user.merchantId;
}

// --- Boutique ---
merchantRouter.get("/store", asyncHandler(async (req: Request, res: Response) => sendData(res, await merchantService.getMyStore(merchantId(req)))));
merchantRouter.post("/store", validate({ body: storeSchema }), asyncHandler(async (req: Request, res: Response) => sendData(res, await merchantService.createStore(merchantId(req), req.body), 201)));
merchantRouter.put("/store", validate({ body: storeSchema }), asyncHandler(async (req: Request, res: Response) => sendData(res, await merchantService.updateStore(merchantId(req), req.body))));

// --- Produits ---
merchantRouter.post("/products", validate({ body: createProductSchema }), asyncHandler(async (req: Request, res: Response) => sendData(res, await merchantService.createProduct(merchantId(req), req.body), 201)));
merchantRouter.patch("/products/:id", validate({ params: productIdParamSchema, body: updateProductSchema }), asyncHandler(async (req: Request, res: Response) => sendData(res, await merchantService.updateProduct(merchantId(req), req.params.id, req.body))));
merchantRouter.delete(
  "/products/:id",
  validate({ params: productIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await merchantService.deleteProduct(merchantId(req), req.params.id);
    res.status(204).send();
  })
);
merchantRouter.post(
  "/products/:id/media",
  uploadPublicMedia.fields([
    { name: "photos", maxCount: 10 },
    { name: "spots", maxCount: 5 },
  ]),
  validate({ params: productIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files ?? {}) as { photos?: Express.Multer.File[]; spots?: Express.Multer.File[] };
    const media = [
      ...(files.photos ?? []).map((f) => ({ filename: f.filename, type: "PHOTO" as const })),
      ...(files.spots ?? []).map((f) => ({ filename: f.filename, type: "SPOT_PUB" as const })),
    ];
    sendData(res, await merchantService.addProductMedia(merchantId(req), req.params.id, media), 201);
  })
);

// --- Commandes & reglements ---
merchantRouter.get(
  "/orders",
  validate({ query: listMerchantOrdersQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status } = req.query as unknown as { page: number; limit: number; status?: never };
    const { items, total } = await merchantService.listMerchantOrders(merchantId(req), { page, limit }, status);
    sendPage(res, items, { page, limit }, total);
  })
);

merchantRouter.get(
  "/settlements",
  validate({ query: paginationQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { items, total } = await merchantService.listSettlements(merchantId(req), { page, limit });
    sendPage(res, items, { page, limit }, total);
  })
);

// --- QR & retrait ---
merchantRouter.post(
  "/qr/scan",
  sensitiveActionRateLimiter,
  validate({ body: scanQrSchema }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await withdrawalService.scanQr(merchantId(req), req.body.qrToken)))
);

merchantRouter.post(
  "/orders/:id/withdrawal-confirm",
  sensitiveActionRateLimiter,
  validate({ params: orderIdParamSchema, body: scanQrSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await withdrawalService.confirmWithdrawal(merchantId(req), req.params.id, req.body.qrToken))
  )
);
