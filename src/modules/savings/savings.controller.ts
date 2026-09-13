import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as savingsService from "./savings.service";

export async function getClientSavings(req: Request, res: Response): Promise<void> {
  if (!req.user?.clientId) {
    throw AppError.unauthorized();
  }

  const savings = await savingsService.listClientSavings(req.user.clientId);
  res.status(200).json({ data: savings });
}
