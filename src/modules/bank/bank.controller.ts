import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import * as bankService from "./bank.service";

function requireBankId(req: Request): string {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user.id;
}

export async function listCreditRequests(req: Request, res: Response): Promise<void> {
  const bankId = requireBankId(req);
  const requests = await bankService.listCreditRequests(bankId);
  res.status(200).json({ data: requests });
}

export async function getCreditRequest(req: Request, res: Response): Promise<void> {
  const bankId = requireBankId(req);
  const request = await bankService.getCreditRequestDetail(bankId, req.params.id);
  res.status(200).json(request);
}

export async function approveCreditRequest(req: Request, res: Response): Promise<void> {
  const bankId = requireBankId(req);
  const result = await bankService.approveCreditRequest(bankId, req.params.id);
  res.status(200).json(result);
}

export async function rejectCreditRequest(req: Request, res: Response): Promise<void> {
  const bankId = requireBankId(req);
  const result = await bankService.rejectCreditRequest(bankId, req.params.id, req.body.reason);
  res.status(200).json(result);
}

export async function executeTransfer(req: Request, res: Response): Promise<void> {
  const bankId = requireBankId(req);
  const result = await bankService.executeTransfer(bankId, req.params.id);
  res.status(200).json(result);
}
