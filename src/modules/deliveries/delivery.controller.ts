import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as deliveryService from "./delivery.service";

export async function scanQrCode(req: Request, res: Response): Promise<void> {
  if (!req.user?.merchantId) {
    throw AppError.unauthorized();
  }

  const result = await deliveryService.scanQrCode(req.user.merchantId, req.params.id, req.body.qrCodeToken);
  res.status(200).json(result);
}
