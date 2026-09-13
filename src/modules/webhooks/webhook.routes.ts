import { Router } from "express";
import { webhookRateLimiter } from "@common/middleware/rateLimiter";
import { asyncHandler } from "@common/utils/asyncHandler";
import * as webhookController from "./webhook.controller";

// Endpoints publics appeles par Orange Money / Coris Money. Pas de requireAuth ici :
// l'authenticite est verifiee via PaymentProvider.verifyWebhook (signature fournisseur).
//
// Pas de idempotent() ici (contrairement a /bank/transfers/:id/execute ou
// /admin/credits/:id/payout) : ce middleware exige un en-tete Idempotency-Key que
// l'operateur ne fournira pas forcement sur un rejeu de webhook. L'idempotence est deja
// garantie plus bas par la contrainte UNIQUE sur savings_deposits.transaction_reference
// (verifiee explicitement dans processSavingsDeposit).
export const webhookRouter = Router();

webhookRouter.post("/orange-money", webhookRateLimiter, asyncHandler(webhookController.orangeMoneyWebhook));
webhookRouter.post("/coris-money", webhookRateLimiter, asyncHandler(webhookController.corisMoneyWebhook));
