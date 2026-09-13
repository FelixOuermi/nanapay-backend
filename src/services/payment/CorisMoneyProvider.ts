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
 * TODO integration reelle : appeler l'API Coris Money avec CORIS_MONEY_BASE_URL /
 * CORIS_MONEY_API_KEY (jamais exposes au Front-end). Squelette conforme a l'interface
 * PaymentProvider pour ne pas coupler la logique metier au fournisseur.
 */
export class CorisMoneyProvider implements PaymentProvider {
  readonly name = "CORIS_MONEY" as const;

  async requestCollection(_request: PaymentCollectionRequest): Promise<PaymentCollectionResult> {
    void env.CORIS_MONEY_BASE_URL;
    throw new Error("CorisMoneyProvider.requestCollection: integration non implementee");
  }

  async requestPayout(_request: PayoutRequest): Promise<PayoutResult> {
    throw new Error("CorisMoneyProvider.requestPayout: integration non implementee");
  }

  verifyWebhook(
    _rawBody: unknown,
    _headers: Record<string, string | string[] | undefined>
  ): WebhookVerificationResult {
    throw new Error("CorisMoneyProvider.verifyWebhook: integration non implementee");
  }
}
