import { createHmac, timingSafeEqual } from "node:crypto";

/** Signature attendue : HMAC-SHA256 hexadecimal du corps brut, avec le secret partage. */
export function computeWebhookSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** Comparaison en temps constant ; accepte un prefixe optionnel "sha256=". */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const provided = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = computeWebhookSignature(rawBody, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
