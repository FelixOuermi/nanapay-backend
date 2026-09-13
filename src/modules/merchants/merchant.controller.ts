import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as merchantService from "./merchant.service";

interface ProductMediaFiles {
  photos?: Express.Multer.File[];
  spots?: Express.Multer.File[];
}

function requireMerchantId(req: Request): string {
  if (!req.user?.merchantId) {
    throw AppError.unauthorized();
  }
  return req.user.merchantId;
}

function toPublicMediaUrl(file: Express.Multer.File): string {
  return `/media/${file.filename}`;
}

export async function createShop(req: Request, res: Response): Promise<void> {
  const merchantId = requireMerchantId(req);
  const shop = await merchantService.createShop(merchantId, req.body);
  res.status(201).json(shop);
}

export async function updateShop(req: Request, res: Response): Promise<void> {
  const merchantId = requireMerchantId(req);
  const shop = await merchantService.updateShop(merchantId, req.body);
  res.status(200).json(shop);
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  const merchantId = requireMerchantId(req);
  const product = await merchantService.createProduct(merchantId, req.body);
  res.status(201).json(product);
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  const merchantId = requireMerchantId(req);
  const product = await merchantService.updateProduct(merchantId, req.params.id, req.body);
  res.status(200).json(product);
}

export async function addProductMedia(req: Request, res: Response): Promise<void> {
  const merchantId = requireMerchantId(req);
  const { photos, spots } = (req.files ?? {}) as ProductMediaFiles;

  const media = await merchantService.addProductMedia(merchantId, req.params.id, {
    photoUrls: (photos ?? []).map(toPublicMediaUrl),
    spotUrls: (spots ?? []).map(toPublicMediaUrl),
  });

  res.status(201).json({ data: media });
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const merchantId = requireMerchantId(req);
  const { status } = req.query as { status?: Parameters<typeof merchantService.listMerchantOrders>[1] };
  const orders = await merchantService.listMerchantOrders(merchantId, status);
  res.status(200).json({ data: orders });
}
