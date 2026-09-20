process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.PAYMENT_WEBHOOK_SECRET = "test-webhook-secret";
process.env.NODE_ENV = "test";

import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../../src/app";
import { computeWebhookSignature } from "@services/payment/webhookSignature";
import { updateProductSchema, createProductSchema } from "@modules/merchants/merchant.validation";
import { registerSchema } from "@modules/auth/auth.validation";

// Ces tests traversent toute la pile Express (middlewares, RBAC, validation, gestion
// d'erreurs) sans jamais atteindre la base : chaque cas est refuse avant tout acces DB.
const app = createApp();

const tokenFor = (role: string) => jwt.sign({ sub: "user-1", role, clientId: "c1", merchantId: "m1", bankId: "b1" }, "test-access-secret", { expiresIn: 60 });

describe("contrat d'erreur { code, message, details?, requestId }", () => {
  it("route inconnue : 404 avec requestId (echo de X-Request-Id)", async () => {
    const res = await request(app).get("/api/n-existe-pas").set("X-Request-Id", "req-abcdef123");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND", requestId: "req-abcdef123" });
    expect(res.headers["x-request-id"]).toBe("req-abcdef123");
  });

  it("genere un requestId quand il n'est pas fourni", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
    expect(typeof res.body.requestId).toBe("string");
  });

  it("validation : 422 VALIDATION_ERROR avec details", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "pas-un-email" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(res.body.details).toBeDefined();
  });

  it("alias historique /api/v1 toujours monte", async () => {
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
  });
});

describe("RBAC (CLIENT, MERCHANT, BANK, ADMIN)", () => {
  it.each([
    ["GET", "/api/orders", "MERCHANT"],
    ["GET", "/api/merchant/orders", "CLIENT"],
    ["GET", "/api/bank/credit-requests", "CLIENT"],
    ["GET", "/api/admin/dashboard", "BANK"],
    ["PATCH", "/api/bank/credit-profiles/x/decision", "MERCHANT"],
    ["POST", "/api/merchant/qr/scan", "CLIENT"],
    ["GET", "/api/credit/profile", "MERCHANT"],
    ["POST", "/api/vaults/x/use", "ADMIN"],
    ["GET", "/api/admin/audit-logs", "CLIENT"],
  ])("%s %s est interdit au role %s (403)", async (method, url, role) => {
    const res = await request(app)[method.toLowerCase() as "get"](url).set("Authorization", `Bearer ${tokenFor(role)}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("refuse un jeton invalide", async () => {
    const res = await request(app).get("/api/orders").set("Authorization", "Bearer n-importe-quoi");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/webhooks/payment - signature", () => {
  const body = { providerTransactionId: "TX-1", orderId: "o1", amount: 1000, currency: "XOF", status: "SUCCESS", timestamp: "2026-01-01T00:00:00Z" };

  it("refuse une requete sans signature (401)", async () => {
    const res = await request(app).post("/api/webhooks/payment").send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("refuse une mauvaise signature (401)", async () => {
    const res = await request(app).post("/api/webhooks/payment").set("X-Signature", "deadbeef").send(body);
    expect(res.status).toBe(401);
  });

  it("refuse un corps altere apres signature (401)", async () => {
    const signature = computeWebhookSignature(JSON.stringify(body), "test-webhook-secret");
    const res = await request(app)
      .post("/api/webhooks/payment")
      .set("X-Signature", signature)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ ...body, amount: 999999 }));
    expect(res.status).toBe(401);
  });

  it("signature valide mais corps hors contrat : 422 avant tout acces base", async () => {
    const bad = { ...body, amount: 10.5 };
    const raw = JSON.stringify(bad);
    const res = await request(app)
      .post("/api/webhooks/payment")
      .set("X-Signature", computeWebhookSignature(raw, "test-webhook-secret"))
      .set("Content-Type", "application/json")
      .send(raw);
    expect(res.status).toBe(422);
  });
});

describe("regles de validation d'entree", () => {
  it("le prix d'un produit publie est definitif : PATCH avec price est refuse", () => {
    expect(updateProductSchema.safeParse({ price: 1 }).success).toBe(false);
    expect(updateProductSchema.safeParse({ stock: 5, title: "Nouveau titre" }).success).toBe(true);
  });

  it("les montants sont des entiers FCFA, jamais des flottants", () => {
    expect(createProductSchema.safeParse({ title: "x", price: 1500.5, stock: 1 }).success).toBe(false);
    expect(createProductSchema.safeParse({ title: "x", price: 1500, stock: 1 }).success).toBe(true);
  });

  it("l'inscription publique ne permet ni BANK ni ADMIN", () => {
    const base = { email: "a@b.co", password: "Password123!", firstName: "A", lastName: "B" };
    expect(registerSchema.safeParse({ ...base, role: "ADMIN" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, role: "BANK" }).success).toBe(false);
    expect(
      registerSchema.safeParse({ ...base, role: "CLIENT", phoneNumber: "70000000", cityId: "c", communeId: "d" }).success
    ).toBe(true);
  });
});
