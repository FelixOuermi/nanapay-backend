import { Router } from "express";
import { requireAuth } from "@common/middleware/auth";
import { requireRole } from "@common/middleware/rbac";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { searchShopsQuerySchema, shopIdParamSchema } from "./market.validation";
import * as marketController from "./market.controller";

// Regroupe les endpoints de decouverte cote Client : /market/shops et /shops/:id/products.
// Ce routeur est monte a la racine de l'API (pas de prefixe dedie), donc les middlewares
// d'auth sont appliques route par route plutot qu'en router.use() : un router.use() sans
// chemin s'executerait pour TOUTE requete traversant ce routeur, meme celles qui ne
// correspondent a aucune de ses routes (ex: un 404 legitime deviendrait un faux 401).
export const marketRouter = Router();

marketRouter.get(
  "/market/shops",
  requireAuth,
  requireRole("CLIENT"),
  validate({ query: searchShopsQuerySchema }),
  asyncHandler(marketController.searchShops)
);
marketRouter.get(
  "/shops/:id/products",
  requireAuth,
  requireRole("CLIENT"),
  validate({ params: shopIdParamSchema }),
  asyncHandler(marketController.listShopProducts)
);
