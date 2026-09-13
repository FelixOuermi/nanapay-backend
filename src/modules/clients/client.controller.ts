import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import { listUserNotifications } from "@services/notification/notificationService";
import * as clientService from "./client.service";

export async function getProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const profile = await clientService.getProfile(req.user.id);
  res.status(200).json(profile);
}

export async function getNotifications(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const data = await listUserNotifications(req.user.id);
  res.status(200).json({ data });
}
