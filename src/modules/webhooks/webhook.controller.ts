import { Request, Response } from "express";
import { AppError } from "@common/errors/AppError";
import { getPaymentProvider } from "@services/payment/paymentProviderFactory";
import { processSavingsDeposit } from "@modules/savings/savings.service";
import { MobileMoneyOperator } from "@prisma/client";

async function handleMobileMoneyWebhook(operator: MobileMoneyOperator, req: Request, res: Response): Promise<void> {
  const provider = getPaymentProvider(operator);
  const verification = provider.verifyWebhook(req.body, req.headers);

  if (!verification.isValid) {
    throw AppError.badRequest("Signature de webhook invalide");
  }

  if (verification.status !== "SUCCESS") {
    // Un depot echoue cote operateur n'a rien a mettre a jour côte NanaPay.
    res.status(200).json({ received: true, processed: false });
    return;
  }

  const result = await processSavingsDeposit({
    orderId: verification.externalReference,
    transactionReference: verification.transactionReference,
    amount: verification.amount,
    operator,
  });

  res.status(200).json({ received: true, processed: true, ...result });
}

export async function orangeMoneyWebhook(req: Request, res: Response): Promise<void> {
  await handleMobileMoneyWebhook("ORANGE_MONEY", req, res);
}

export async function corisMoneyWebhook(req: Request, res: Response): Promise<void> {
  await handleMobileMoneyWebhook("CORIS_MONEY", req, res);
}
