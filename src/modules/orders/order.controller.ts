import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as orderService from "./order.service";

function requireClientId(req: Request): string {
  if (!req.user?.clientId) {
    throw AppError.unauthorized();
  }
  return req.user.clientId;
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  const clientId = requireClientId(req);
  const order = await orderService.createOrder(clientId, req.body);
  res.status(201).json(order);
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const clientId = requireClientId(req);
  const order = await orderService.getOrderDetail(clientId, req.params.id);
  res.status(200).json(order);
}

export async function extendSavings(req: Request, res: Response): Promise<void> {
  const clientId = requireClientId(req);
  const order = await orderService.extendSavingsDeadline(clientId, req.params.id, req.body.months);
  res.status(200).json(order);
}

export async function getOrderQrCode(req: Request, res: Response): Promise<void> {
  const clientId = requireClientId(req);
  const result = await orderService.getOrderQrCode(clientId, req.params.id);
  res.status(200).json(result);
}
