import { computeWebhookSignature, verifyWebhookSignature } from "@services/payment/webhookSignature";

describe("webhookSignature", () => {
  const secret = "test-secret";
  const body = Buffer.from(JSON.stringify({ providerTransactionId: "TX1", amount: 1000 }));

  it("accepte une signature valide (avec ou sans prefixe sha256=)", () => {
    const signature = computeWebhookSignature(body, secret);
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${signature}`, secret)).toBe(true);
  });

  it("refuse une signature absente, alteree ou calculee avec un autre secret", () => {
    const signature = computeWebhookSignature(body, secret);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature.replace(/.$/, "0"), secret)).toBe(false);
    expect(verifyWebhookSignature(body, computeWebhookSignature(body, "autre"), secret)).toBe(false);
  });

  it("refuse un corps modifie apres signature", () => {
    const signature = computeWebhookSignature(body, secret);
    expect(verifyWebhookSignature(Buffer.from('{"amount":999999}'), signature, secret)).toBe(false);
  });
});
