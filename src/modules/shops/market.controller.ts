import { Request, Response } from "express";
import * as marketService from "./market.service";

export async function searchShops(req: Request, res: Response): Promise<void> {
  const { city, township, search } = req.query as { city?: string; township?: string; search?: string };
  const shops = await marketService.searchShops({ city, township, search });
  res.status(200).json({ data: shops });
}

export async function listShopProducts(req: Request, res: Response): Promise<void> {
  const result = await marketService.listShopProducts(req.params.id);
  res.status(200).json(result);
}
