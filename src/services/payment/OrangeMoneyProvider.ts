import { env } from "@config/env";
import {
  PaymentCollectionRequest,
  PaymentCollectionResult,
  PaymentProvider,
  PayoutRequest,
  PayoutResult,
  WebhookVerificationResult,
} from "./PaymentProvider";

/**
 * TODO integration reelle : appeler l'API Orange Money avec ORANGE_MONEY_BASE_URL /
 * ORANGE_MONEY_API_KEY (jamais exposes au Front-end). Squelette conforme a l'interface
 * PaymentProvider pour ne pas coupler la logique metier au fournisseur.
 */
export class OrangeMoneyProvider implements PaymentProvider {
  readonly name = "ORANGE_MONEY" as const;

  async requestCollection(_request: PaymentCollectionRequest): Promise<PaymentCollectionResult> {
    void env.ORANGE_MONEY_BASE_URL;
    throw new Error("OrangeMoneyProvider.requestCollection: integration non implementee");
  }

  async requestPayout(_request: PayoutRequest): Promise<PayoutResult> {
    throw new Error("OrangeMoneyProvider.requestPayout: integration non implementee");
  }

  verifyWebhook(
    _rawBody: unknown,
    _headers: Record<string, string | string[] | undefined>
  ): WebhookVerificationResult {
    throw new Error("OrangeMoneyProvider.verifyWebhook: integration non implementee");
  }
}
