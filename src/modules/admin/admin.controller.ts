import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as adminService from "./admin.service";

function requireAdminId(req: Request): string {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user.id;
}

export async function listPendingClients(_req: Request, res: Response): Promise<void> {
  const clients = await adminService.listPendingClients();
  res.status(200).json({ data: clients });
}

export async function listPendingMerchants(_req: Request, res: Response): Promise<void> {
  const merchants = await adminService.listPendingMerchants();
  res.status(200).json({ data: merchants });
}

export async function approveClient(req: Request, res: Response): Promise<void> {
  const adminId = requireAdminId(req);
  const result = await adminService.approveClient(req.params.id, adminId);
  res.status(200).json(result);
}

export async function rejectClient(req: Request, res: Response): Promise<void> {
  const adminId = requireAdminId(req);
  const result = await adminService.rejectClient(req.params.id, adminId, req.body.reason);
  res.status(200).json(result);
}

export async function approveMerchant(req: Request, res: Response): Promise<void> {
  const adminId = requireAdminId(req);
  const result = await adminService.approveMerchant(req.params.id, adminId);
  res.status(200).json(result);
}

export async function rejectMerchant(req: Request, res: Response): Promise<void> {
  const adminId = requireAdminId(req);
  const result = await adminService.rejectMerchant(req.params.id, adminId, req.body.reason);
  res.status(200).json(result);
}

export async function listSavings(_req: Request, res: Response): Promise<void> {
  const data = await adminService.listSavingsOverview();
  res.status(200).json({ data });
}

export async function listCredits(_req: Request, res: Response): Promise<void> {
  const data = await adminService.listCreditsOverview();
  res.status(200).json({ data });
}

export async function processCreditPayout(req: Request, res: Response): Promise<void> {
  const adminId = requireAdminId(req);
  const payout = await adminService.processCreditPayout(req.params.id, adminId);
  res.status(200).json(payout);
}

export async function listTransactions(_req: Request, res: Response): Promise<void> {
  const data = await adminService.listTransactions();
  res.status(200).json(data);
}

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const adminId = requireAdminId(req);
  const data = await adminService.listAdminNotifications(adminId);
  res.status(200).json({ data });
}
