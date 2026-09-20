import { Request, Response, Router } from "express";
import { env } from "@config/env";
import { AppError } from "@common/errors/AppError";
import { webhookRateLimiter } from "@common/middleware/rateLimiter";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendData } from "@common/utils/response";
import { verifyWebhookSignature } from "@services/payment/webhookSignature";
import { paymentWebhookSchema, processPaymentWebhook } from "./payment.service";

// POST /api/webhooks/payment : endpoint public appele par l'infrastructure Mobile Money.
// Pas de requireAuth : l'authenticite est prouvee par la signature HMAC (X-Signature)
// calculee sur le corps BRUT (capture par app.ts dans req.rawBody).
export const webhookRouter = Router();

webhookRouter.post(
  "/payment",
  webhookRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.PAYMENT_WEBHOOK_SECRET) {
      throw new AppError(503, "WEBHOOK_NOT_CONFIGURED", "Secret de webhook non configure");
    }

    const signature = req.header("X-Signature");
    if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature, env.PAYMENT_WEBHOOK_SECRET)) {
      throw AppError.unauthorized("Signature de webhook invalide");
    }

    const payload = paymentWebhookSchema.parse(req.body);
    sendData(res, await processPaymentWebhook(payload));
  })
);
