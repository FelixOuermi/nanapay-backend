import {
  canExtendSavings,
  computeCreditSettlement,
  computeCreditTerms,
  computeMaxCreditDurationMonths,
  computeSavingsPenalty,
  computeSavingsSettlement,
  computeVaultTerms,
  getSavingsTerms,
  validateSavingsDeposit,
} from "@services/financial/financialService";
import { DEFAULT_FINANCIAL_PARAMS } from "@services/financial/financial.constants";

describe("financialService - epargne (cahier, section 6)", () => {
  it.each([
    [30_000, 1_000, 8],
    [50_000, 1_000, 8],
    [50_001, 2_000, 18],
    [100_000, 2_000, 18],
    [100_001, 5_000, 36],
    [900_000, 5_000, 36],
  ])("prix %i FCFA -> minimum %i FCFA, %i mois max", (price, minInstallment, maxDurationMonths) => {
    expect(getSavingsTerms(price)).toEqual({ minInstallment, maxDurationMonths });
  });

  it("refuse un prix nul ou negatif", () => {
    expect(() => getSavingsTerms(0)).toThrow();
    expect(() => getSavingsTerms(-5)).toThrow();
  });

  it("prolongation : 2 mois maximum au total", () => {
    expect(canExtendSavings(0, 2)).toBe(true);
    expect(canExtendSavings(1, 1)).toBe(true);
    expect(canExtendSavings(1, 2)).toBe(false);
    expect(canExtendSavings(2, 1)).toBe(false);
    expect(canExtendSavings(0, 0)).toBe(false);
  });

  it("echec : penalite 15 %, remboursement 85 %, somme exacte", () => {
    expect(computeSavingsPenalty(40_000)).toEqual({ penaltyAmount: 6_000, refundAmount: 34_000 });
    const odd = computeSavingsPenalty(33_333);
    expect(odd.penaltyAmount + odd.refundAmount).toBe(33_333);
    expect(Number.isInteger(odd.penaltyAmount)).toBe(true);
  });

  describe("validateSavingsDeposit", () => {
    it("accepte un versement >= minimum", () => {
      expect(validateSavingsDeposit(2_000, 10_000, 1_000)).toEqual({ valid: true });
    });

    it("refuse un versement sous le minimum", () => {
      expect(validateSavingsDeposit(500, 10_000, 1_000)).toMatchObject({ valid: false });
    });

    it("accepte un dernier versement inferieur au minimum s'il solde exactement le reste", () => {
      expect(validateSavingsDeposit(300, 300, 1_000)).toEqual({ valid: true });
    });

    it("refuse un versement superieur au reste a epargner", () => {
      expect(validateSavingsDeposit(5_000, 4_000, 1_000)).toMatchObject({ valid: false });
    });

    it("refuse un montant non entier ou nul", () => {
      expect(validateSavingsDeposit(1_000.5, 10_000, 1_000)).toMatchObject({ valid: false });
      expect(validateSavingsDeposit(0, 10_000, 1_000)).toMatchObject({ valid: false });
    });
  });
});

describe("financialService - credit (cahier, section 6)", () => {
  it.each([
    [40_000, 8],
    [50_000, 8],
    [50_001, 12],
    [100_000, 12],
    [100_001, 18], // +1 tranche de 50 000 entamee -> +6 mois
    [150_000, 18],
    [150_001, 24],
    [250_000, 30],
    [300_000, 36],
  ])("prix %i FCFA -> %i mois max", (price, months) => {
    expect(computeMaxCreditDurationMonths(price)).toBe(months);
  });

  it("calcule frais, montant a virer et mensualite en entiers FCFA", () => {
    const terms = computeCreditTerms(80_000, 10);
    expect(terms.bankFeeAmount).toBe(1_600); // 2 %
    expect(terms.totalAmountToWire).toBe(81_600);
    expect(terms.monthlyInstallment).toBe(8_160);
    expect(Object.values(terms).every(Number.isInteger)).toBe(true);
  });

  it("arrondit la mensualite au FCFA superieur", () => {
    expect(computeCreditTerms(40_000, 7).monthlyInstallment).toBe(Math.ceil(40_800 / 7));
  });

  it("refuse une duree hors bareme ou non entiere", () => {
    expect(() => computeCreditTerms(40_000, 9)).toThrow(/maximum autorise 8/);
    expect(() => computeCreditTerms(40_000, 0)).toThrow();
    expect(() => computeCreditTerms(40_000, 2.5)).toThrow();
  });

  it("reglement commercant credit : commission 4 % sur le prix", () => {
    expect(computeCreditSettlement(100_000)).toEqual({ commissionRate: 0.04, commissionAmount: 4_000, netAmount: 96_000 });
  });
});

describe("financialService - reglement epargne/coffre et coffre", () => {
  it.each([
    [40_000, 0.08, 3_200],
    [60_000, 0.05, 3_000],
    [200_000, 0.03, 6_000],
  ])("prix %i -> taux %d, commission %i", (price, rate, commission) => {
    const settlement = computeSavingsSettlement(price);
    expect(settlement.commissionRate).toBe(rate);
    expect(settlement.commissionAmount).toBe(commission);
    expect(settlement.netAmount).toBe(price - commission);
  });

  it("coffre : mensualite arrondie au superieur, duree alignee sur le bareme credit", () => {
    expect(computeVaultTerms(50_000, 7)).toEqual({ monthlyAmount: 7_143, maxDurationMonths: 8 });
    expect(() => computeVaultTerms(50_000, 12)).toThrow();
  });
});

describe("financialService - parametres configurables (back-office)", () => {
  it("applique les parametres fournis a la place des valeurs par defaut", () => {
    const params = { ...DEFAULT_FINANCIAL_PARAMS, savingsPenaltyRate: 0.2, creditMerchantCommissionRate: 0.1 };
    expect(computeSavingsPenalty(10_000, params)).toEqual({ penaltyAmount: 2_000, refundAmount: 8_000 });
    expect(computeCreditSettlement(10_000, params).commissionAmount).toBe(1_000);
  });
});
