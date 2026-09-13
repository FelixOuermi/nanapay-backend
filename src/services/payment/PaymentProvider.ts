// Abstraction de paiement Mobile Money : la logique metier (Epargne, webhooks, reversements)
// ne doit jamais dependre directement d'Orange Money ou de Coris Money. Elle passe par cette
// interface commune ; seul le provider concret sait parler au fournisseur.

export interface PaymentCollectionRequest {
  /** Numero du client qui effectue le versement. */
  payerMsisdn: string;
  amount: number;
  /** Reference metier interne (ex: id du savings_deposit en attente). */
  externalReference: string;
}

export interface PaymentCollectionResult {
  providerTransactionId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
}

export interface PayoutRequest {
  /** Numero de reception (Orange Money ou Coris Money) du beneficiaire. */
  recipientMsisdn: string;
  amount: number;
  externalReference: string;
}

export interface PayoutResult {
  providerTransactionId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
}

export interface WebhookVerificationResult {
  isValid: boolean;
  transactionReference: string;
  amount: number;
  status: "SUCCESS" | "FAILED";
  /**
   * Reference metier que NanaPay a fournie a l'initiation du paiement (ici, l'id de la
   * commande) et que l'operateur doit renvoyer telle quelle dans le webhook. Permet de
   * retrouver le savings_plan concerne sans dependre d'un etat "collecte en attente" cote NanaPay.
   */
  externalReference: string;
}

export interface PaymentProvider {
  readonly name: "ORANGE_MONEY" | "CORIS_MONEY";

  /** Initie une collecte (le client verse vers un compte NanaPay). */
  requestCollection(request: PaymentCollectionRequest): Promise<PaymentCollectionResult>;

  /** Initie un reversement (NanaPay -> commercant/client). */
  requestPayout(request: PayoutRequest): Promise<PayoutResult>;

  /** Verifie la signature/l'authenticite d'un webhook entrant avant tout traitement. */
  verifyWebhook(rawBody: unknown, headers: Record<string, string | string[] | undefined>): WebhookVerificationResult;
}
