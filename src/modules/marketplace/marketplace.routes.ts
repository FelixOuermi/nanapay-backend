import { Request, Response, Router } from "express";
import { z } from "zod";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { paginationQuerySchema, sendData, sendPage } from "@common/utils/response";
import * as marketplaceService from "./marketplace.service";

// Decouverte publique (lecture seule) : pas d'authentification requise pour parcourir.
// Monte a la racine de l'API : /marketplace/*, /stores/*, /products/*.
export const marketplaceRouter = Router();

const communesQuery = z.object({ cityId: z.string().min(1) });
const storesQuery = paginationQuerySchema.extend({
  cityId: z.string().min(1).optional(),
  communeId: z.string().min(1).optional(),
});
const storeIdParam = z.object({ storeId: z.string().min(1) });
const productIdParam = z.object({ productId: z.string().min(1) });

marketplaceRouter.get(
  "/marketplace/cities",
  asyncHandler(async (_req: Request, res: Response) => sendData(res, await marketplaceService.listCities()))
);

marketplaceRouter.get(
  "/marketplace/communes",
  validate({ query: communesQuery }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await marketplaceService.listCommunes(String(req.query.cityId)))
  )
);

marketplaceRouter.get(
  "/stores",
  validate({ query: storesQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, cityId, communeId } = req.query as unknown as z.infer<typeof storesQuery>;
    const { items, total } = await marketplaceService.listStores({ cityId, communeId }, { page, limit });
    sendPage(res, items, { page, limit }, total);
  })
);

marketplaceRouter.get(
  "/stores/:storeId",
  validate({ params: storeIdParam }),
  asyncHandler(async (req: Request, res: Response) => sendData(res, await marketplaceService.getStore(req.params.storeId)))
);

marketplaceRouter.get(
  "/products/:productId",
  validate({ params: productIdParam }),
  asyncHandler(async (req: Request, res: Response) =>
    sendData(res, await marketplaceService.getProduct(req.params.productId))
  )
);
