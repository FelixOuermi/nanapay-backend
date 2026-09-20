import {
  AMOUNT_TIER_1_MAX,
  AMOUNT_TIER_2_MAX,
  DEFAULT_FINANCIAL_PARAMS,
  FinancialParams,
} from "./financial.constants";

/**
 * Service financier centralise NanoPay : fonctions pures. Toute regle de calcul (durees,
 * versements minimums, commissions, penalites, montants a virer) passe par ici. Le
 * frontend n'est jamais source de verite pour les regles financieres (cahier, section 1).
 * Les parametres viennent du back-office (settingsService) ; a defaut, les valeurs par defaut.
 * Tous les montants sont des entiers FCFA.
 */

const round = (value: number): number => Math.round(value);

function assertPositivePrice(price: number): void {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Le prix de l'article doit etre positif");
  }
}

// ------------------------------------------------------------------
// EPARGNE
// ------------------------------------------------------------------

export interface SavingsTerms {
  minInstallment: number;
  maxDurationMonths: number;
}

export function getSavingsTerms(price: number, params: FinancialParams = DEFAULT_FINANCIAL_PARAMS): SavingsTerms {
  assertPositivePrice(price);
  const tiers = params.savingsTiers;
  const tier = tiers.find((t) => t.maxAmount === null || price <= t.maxAmount) ?? tiers[tiers.length - 1];
  return { minInstallment: tier.minInstallment, maxDurationMonths: tier.maxDurationMonths };
}

/** Prolongation autorisee tant que le cumul reste <= au maximum (2 mois). */
export function canExtendSavings(
  currentExtensionMonths: number,
  requestedMonths: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): boolean {
  return requestedMonths > 0 && currentExtensionMonths + requestedMonths <= params.savingsExtensionMaxMonths;
}

/**
 * Un versement est valide s'il atteint le minimum du palier, ou s'il solde exactement
 * le reste a epargner (dernier versement, potentiellement inferieur au minimum), et
 * s'il ne depasse pas le reste a epargner.
 */
export function validateSavingsDeposit(
  amount: number,
  remaining: number,
  minInstallment: number
): { valid: true } | { valid: false; reason: string } {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { valid: false, reason: "Montant invalide" };
  }
  if (amount > remaining) {
    return { valid: false, reason: "Montant superieur au reste a epargner" };
  }
  if (amount < minInstallment && amount !== remaining) {
    return { valid: false, reason: `Versement inferieur au minimum de ${minInstallment} FCFA` };
  }
  return { valid: true };
}

export interface SavingsPenalty {
  penaltyAmount: number;
  refundAmount: number;
}

/** Echec apres duree initiale + prolongation : penalite (15 %) et remboursement du reste (85 %). */
export function computeSavingsPenalty(
  savedAmount: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): SavingsPenalty {
  const penaltyAmount = round(savedAmount * params.savingsPenaltyRate);
  return { penaltyAmount, refundAmount: savedAmount - penaltyAmount };
}

export interface MerchantSettlementAmounts {
  commissionRate: number;
  commissionAmount: number;
  netAmount: number;
}

export function getSavingsCommissionRate(price: number, params: FinancialParams = DEFAULT_FINANCIAL_PARAMS): number {
  const rates = params.savingsCommissionRates;
  if (price < AMOUNT_TIER_1_MAX) return rates.tier1;
  if (price < AMOUNT_TIER_2_MAX) return rates.tier2;
  return rates.tier3;
}

/** Reglement commercant pour une commande financee par epargne ou coffre. */
export function computeSavingsSettlement(
  price: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): MerchantSettlementAmounts {
  const commissionRate = getSavingsCommissionRate(price, params);
  const commissionAmount = round(price * commissionRate);
  return { commissionRate, commissionAmount, netAmount: price - commissionAmount };
}

// ------------------------------------------------------------------
// CREDIT (et duree du Coffre, alignee sur le meme bareme)
// ------------------------------------------------------------------

/**
 * <= 50 000 : 8 mois ; 50 000 - 100 000 : 12 mois ; au-dela, +6 mois par tranche
 * (entamee) supplementaire de 50 000 FCFA.
 */
export function computeMaxCreditDurationMonths(
  price: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): number {
  assertPositivePrice(price);
  if (price <= AMOUNT_TIER_1_MAX) return params.creditTier1MaxMonths;
  if (price <= AMOUNT_TIER_2_MAX) return params.creditTier2MaxMonths;
  const extraBrackets = Math.ceil((price - AMOUNT_TIER_2_MAX) / params.creditBracketSize);
  return params.creditTier2MaxMonths + extraBrackets * params.creditExtraMonthsPerBracket;
}

/** Le backend valide toujours la duree lui-meme, sans faire confiance au frontend. */
export function assertValidCreditDuration(
  price: number,
  months: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): void {
  const maxAllowed = computeMaxCreditDurationMonths(price, params);
  if (!Number.isInteger(months) || months <= 0 || months > maxAllowed) {
    throw new Error(`Duree invalide : ${months} mois demandes, maximum autorise ${maxAllowed} mois pour ${price} FCFA`);
  }
}

export interface CreditTerms {
  bankFeeAmount: number;
  totalAmountToWire: number;
  monthlyInstallment: number;
}

/** Montant a virer par la banque = prix + frais ; mensualite arrondie au FCFA superieur. */
export function computeCreditTerms(
  price: number,
  months: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): CreditTerms {
  assertValidCreditDuration(price, months, params);
  const bankFeeAmount = round(price * params.creditBankFeeRate);
  const totalAmountToWire = price + bankFeeAmount;
  return { bankFeeAmount, totalAmountToWire, monthlyInstallment: Math.ceil(totalAmountToWire / months) };
}

/** Reglement commercant pour un credit : commission (4 %) sur le prix de l'article. */
export function computeCreditSettlement(
  price: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): MerchantSettlementAmounts {
  const commissionAmount = round(price * params.creditMerchantCommissionRate);
  return { commissionRate: params.creditMerchantCommissionRate, commissionAmount, netAmount: price - commissionAmount };
}

// ------------------------------------------------------------------
// COFFRE (prelevement automatique sur salaire)
// ------------------------------------------------------------------

export interface VaultTerms {
  monthlyAmount: number;
  maxDurationMonths: number;
}

export function computeVaultTerms(
  price: number,
  months: number,
  params: FinancialParams = DEFAULT_FINANCIAL_PARAMS
): VaultTerms {
  assertValidCreditDuration(price, months, params);
  return { monthlyAmount: Math.ceil(price / months), maxDurationMonths: computeMaxCreditDurationMonths(price, params) };
}
