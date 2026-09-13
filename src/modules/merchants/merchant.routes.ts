import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { uploadPublicMedia } from "@common/middleware/upload";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import {
  shopSchema,
  createProductSchema,
  updateProductSchema,
  productIdParamSchema,
  listMerchantOrdersQuerySchema,
} from "./merchant.validation";
import * as merchantController from "./merchant.controller";
import * as deliveryController from "@modules/deliveries/delivery.controller";
import { scanQrSchema, orderIdParamSchema } from "@modules/deliveries/delivery.validation";
import * as payoutController from "@modules/payouts/payout.controller";

export const merchantRouter = Router();

merchantRouter.use(requireAuth, requireRole("COMMERCANT"));

merchantRouter.post("/shop", validate({ body: shopSchema }), asyncHandler(merchantController.createShop));
merchantRouter.put("/shop", validate({ body: shopSchema }), asyncHandler(merchantController.updateShop));

merchantRouter.post(
  "/products",
  validate({ body: createProductSchema }),
  asyncHandler(merchantController.createProduct)
);
merchantRouter.put(
  "/products/:id",
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  asyncHandler(merchantController.updateProduct)
);
merchantRouter.post(
  "/products/:id/media",
  uploadPublicMedia.fields([
    { name: "photos", maxCount: 10 },
    { name: "spots", maxCount: 5 },
  ]),
  validate({ params: productIdParamSchema }),
  asyncHandler(merchantController.addProductMedia)
);

merchantRouter.get(
  "/orders",
  validate({ query: listMerchantOrdersQuerySchema }),
  asyncHandler(merchantController.listOrders)
);
merchantRouter.post(
  "/orders/:id/scan-qr",
  validate({ params: orderIdParamSchema, body: scanQrSchema }),
  asyncHandler(deliveryController.scanQrCode)
);

merchantRouter.get("/payouts", asyncHandler(payoutController.listMerchantPayouts));
