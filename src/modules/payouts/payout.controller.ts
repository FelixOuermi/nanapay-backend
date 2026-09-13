import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as payoutService from "./payout.service";

export async function listMerchantPayouts(req: Request, res: Response): Promise<void> {
  if (!req.user?.merchantId) {
    throw AppError.unauthorized();
  }

  const payouts = await payoutService.listMerchantPayouts(req.user.merchantId);
  res.status(200).json({ data: payouts });
}
