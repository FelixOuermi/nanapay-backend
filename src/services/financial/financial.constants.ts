// Parametres financiers PAR DEFAUT de NanoPay. Ils sont modifiables depuis le back-office
// (table settings, cle "financial.params", voir settingsService) : le cahier exige que les
// formules (4 %, 20 %, 15 %...) et autres parametres financiers soient configurables.
// Aucune valeur ne doit etre recopiee en dur ailleurs : tout passe par financialService.

export interface SavingsTier {
  /** Plafond inclusif du palier en FCFA ; null = sans plafond (dernier palier). */
  maxAmount: number | null;
  minInstallment: number;
  maxDurationMonths: number;
}

export interface FinancialParams {
  savingsTiers: SavingsTier[];
  savingsExtensionMaxMonths: number;
  /** Penalite en cas d'echec de l'epargne ; le client recupere (1 - penalite). */
  savingsPenaltyRate: number;
  /** Commission NanoPay sur le reglement commercant d'une epargne/d'un coffre, par palier. */
  savingsCommissionRates: { tier1: number; tier2: number; tier3: number };
  creditTier1MaxMonths: number; // <= 50 000 FCFA
  creditTier2MaxMonths: number; // 50 000 - 100 000 FCFA
  creditExtraMonthsPerBracket: number; // par tranche supplementaire
  creditBracketSize: number;
  /** Frais factures a la banque en plus du prix : montant a virer = prix + frais. */
  creditBankFeeRate: number;
  /** Commission NanoPay sur le reglement commercant d'un credit. */
  creditMerchantCommissionRate: number;
  /** Duree de validite d'un jeton QR, en heures. */
  qrTtlHours: number;
}

export const AMOUNT_TIER_1_MAX = 50_000; // FCFA
export const AMOUNT_TIER_2_MAX = 100_000; // FCFA

export const DEFAULT_FINANCIAL_PARAMS: FinancialParams = {
  savingsTiers: [
    { maxAmount: AMOUNT_TIER_1_MAX, minInstallment: 1_000, maxDurationMonths: 8 },
    { maxAmount: AMOUNT_TIER_2_MAX, minInstallment: 2_000, maxDurationMonths: 18 },
    { maxAmount: null, minInstallment: 5_000, maxDurationMonths: 36 },
  ],
  savingsExtensionMaxMonths: 2,
  savingsPenaltyRate: 0.15,
  savingsCommissionRates: { tier1: 0.08, tier2: 0.05, tier3: 0.03 },
  creditTier1MaxMonths: 8,
  creditTier2MaxMonths: 12,
  creditExtraMonthsPerBracket: 6,
  creditBracketSize: 50_000,
  creditBankFeeRate: 0.02,
  creditMerchantCommissionRate: 0.04,
  qrTtlHours: 72,
};
