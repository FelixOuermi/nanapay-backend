import {
  getSavingsTerms,
  computeSavingsPenalty,
  getSavingsCommissionRate,
  computeMaxCreditDurationMonths,
  computeBankWireAmount,
  computeCreditMerchantPayout,
  assertValidCreditDuration,
} from "@services/financial/financialService";

describe("financialService - Epargne", () => {
  it("applique le palier 0-50 000 FCFA", () => {
    expect(getSavingsTerms(30_000)).toEqual({ minInstallmentAmount: 1_000, maxDurationMonths: 8 });
  });

  it("applique le palier 50 000-100 000 FCFA", () => {
    expect(getSavingsTerms(75_000)).toEqual({ minInstallmentAmount: 2_000, maxDurationMonths: 18 });
  });

  it("applique le palier > 100 000 FCFA", () => {
    expect(getSavingsTerms(150_000)).toEqual({ minInstallmentAmount: 5_000, maxDurationMonths: 36 });
  });

  it("applique la penalite actuelle de 15% et un remboursement de 85% en cas de depassement de delai", () => {
    const result = computeSavingsPenalty(100_000);
    expect(result.penaltyAmount).toBe(15_000);
    expect(result.refundAmount).toBe(85_000);
    expect(result.penaltyAmount + result.refundAmount).toBe(100_000);
  });

  it("applique un taux de commission degressif selon le prix de l'article", () => {
    expect(getSavingsCommissionRate(40_000)).toBe(0.08);
    expect(getSavingsCommissionRate(75_000)).toBe(0.05);
    expect(getSavingsCommissionRate(120_000)).toBe(0.03);
  });
});

describe("financialService - Credit Bancaire", () => {
  it("limite a 8 mois pour un article <= 50 000 FCFA", () => {
    expect(computeMaxCreditDurationMonths(50_000)).toBe(8);
  });

  it("limite a 12 mois pour un article entre 50 000 et 100 000 FCFA", () => {
    expect(computeMaxCreditDurationMonths(100_000)).toBe(12);
  });

  it("ajoute 6 mois par tranche entamee de 50 000 FCFA au-dela de 100 000", () => {
    expect(computeMaxCreditDurationMonths(120_000)).toBe(18); // tranche entamee -> arrondi superieur
    expect(computeMaxCreditDurationMonths(150_000)).toBe(18);
    expect(computeMaxCreditDurationMonths(150_001)).toBe(24);
  });

  it("refuse une duree hors limite", () => {
    expect(() => assertValidCreditDuration(50_000, 9)).toThrow();
    expect(() => assertValidCreditDuration(50_000, 8)).not.toThrow();
  });

  it("calcule le virement banque -> NanaPay avec l'exemple du document (50 000 FCFA)", () => {
    const wire = computeBankWireAmount(50_000);
    expect(wire.bankCommissionAmount).toBe(1_000);
    expect(wire.totalAmountToWire).toBe(51_000);
  });

  it("calcule le reversement commercant avec l'exemple du document (50 000 FCFA)", () => {
    const payout = computeCreditMerchantPayout(50_000);
    expect(payout.commissionAmount).toBe(2_000);
    expect(payout.netAmountPaid).toBe(48_000);
  });
});
