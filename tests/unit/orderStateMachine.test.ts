import { OrderStatus } from "@prisma/client";
import { assertTransition, canTransition } from "@modules/orders/orderStateMachine";
import { formatOrderNumber } from "@common/utils/orderNumber";

describe("orderStateMachine (cahier, section 3)", () => {
  const chain: OrderStatus[] = ["CREEE", "FINANCEMENT_EN_COURS", "FINANCEE", "PRETE_A_LIVRER", "LIVREE", "TERMINEE"];

  it("autorise le circuit nominal etape par etape", () => {
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(canTransition(chain[i], chain[i + 1])).toBe(true);
    }
  });

  it("interdit de sauter une etape ou de revenir en arriere", () => {
    expect(canTransition("CREEE", "PRETE_A_LIVRER")).toBe(false);
    expect(canTransition("FINANCEMENT_EN_COURS", "LIVREE")).toBe(false);
    expect(canTransition("LIVREE", "PRETE_A_LIVRER")).toBe(false);
    expect(canTransition("TERMINEE", "CREEE")).toBe(false);
  });

  it("autorise le retour a CREEE (credit refuse) uniquement depuis FINANCEMENT_EN_COURS", () => {
    expect(canTransition("FINANCEMENT_EN_COURS", "CREEE")).toBe(true);
    expect(canTransition("FINANCEE", "CREEE")).toBe(false);
  });

  it("assertTransition leve un 409", () => {
    expect(() => assertTransition("CREEE", "LIVREE")).toThrow(expect.objectContaining({ statusCode: 409 }));
  });
});

describe("formatOrderNumber", () => {
  it("produit un identifiant lisible NP-AAAA-NNNNNNNN", () => {
    expect(formatOrderNumber(1245, new Date("2026-03-01T00:00:00Z"))).toBe("NP-2026-00001245");
  });
});
