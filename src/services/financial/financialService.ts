import {
  AMOUNT_TIER_1_MAX,
  AMOUNT_TIER_2_MAX,
  SAVINGS_TIERS,
  SAVINGS_EXTENSION_MAX_MONTHS,
  SAVINGS_PENALTY_RATE,
  SAVINGS_REFUND_RATE,
  SAVINGS_COMMISSION_RATE_TIER_1,
  SAVINGS_COMMISSION_RATE_TIER_2,
  SAVINGS_COMMISSION_RATE_TIER_3,
  CREDIT_TIER_1_MAX_MONTHS,
  CREDIT_TIER_2_MAX_MONTHS,
  CREDIT_EXTRA_MONTHS_PER_BRACKET,
  CREDIT_BRACKET_SIZE,
  CREDIT_BANK_WIRE_COMMISSION_RATE,
  CREDIT_MERCHANT_COMMISSION_RATE,
} from "./financial.constants";

/**
 * Service financier centralise NanaPay.
 *
 * Toute la logique de calcul (durees, versements minimums, commissions, penalites,
 * montants a virer) DOIT passer par ce service. Les controleurs/routes ne doivent
 * jamais recalculer ou recopier un taux/seuil localement (cf. cahier des taches, section 12).
 */

// ------------------------------------------------------------------
// EPARGNE
// ------------------------------------------------------------------

export interface SavingsTerms {
  minInstallmentAmount: number;
  maxDurationMonths: number;
}

/** Determine versement minimum + duree max autorises selon le prix de l'article. */
export function getSavingsTerms(articlePrice: number): SavingsTerms {
  if (articlePrice <= 0) {
    throw new Error("Le prix de l'article doit etre positif");
  }

  const tier = SAVINGS_TIERS.find((t) => articlePrice <= t.maxAmount) ?? SAVINGS_TIERS[SAVINGS_TIERS.length - 1];

  return {
    minInstallmentAmount: tier.minInstallment,
    maxDurationMonths: tier.maxDurationMonths,
  };
}

/** Extension d'echeance : autorisee uniquement si le total (base + extensions) reste <= max. */
export function canExtendSavingsDeadline(currentExtendedMonths: number, requestedExtraMonths: number): boolean {
  return currentExtendedMonths + requestedExtraMonths <= SAVINGS_EXTENSION_MAX_MONTHS;
}

/** Taux de commission HT applique par NanaPay sur le reversement Epargne au commercant. */
export function getSavingsCommissionRate(articlePrice: number): number {
  if (articlePrice < AMOUNT_TIER_1_MAX) return SAVINGS_COMMISSION_RATE_TIER_1;
  if (articlePrice < AMOUNT_TIER_2_MAX) return SAVINGS_COMMISSION_RATE_TIER_2;
  return SAVINGS_COMMISSION_RATE_TIER_3;
}

export interface SavingsPayout {
  commissionRate: number;
  commissionAmount: number;
  netAmountPaid: number;
}

/** Montant reverse au commercant a la fin d'une Epargne = montant epargne - commission HT. */
export function computeSavingsPayout(articlePrice: number, savedAmount: number): SavingsPayout {
  const commissionRate = getSavingsCommissionRate(articlePrice);
  const commissionAmount = round2(savedAmount * commissionRate);
  const netAmountPaid = round2(savedAmount - commissionAmount);

  return { commissionRate, commissionAmount, netAmountPaid };
}

export interface SavingsPenalty {
  penaltyAmount: number;
  refundAmount: number;
}

/**
 * Regle actuelle (confirmee) en cas de depassement definitif du delai d'Epargne
 * (delai de base + extension eventuelle, non regularise) :
 *  - penalite de 15% sur la somme totale epargnee
 *  - remboursement de 85% des cotisations au client via Mobile Money
 *  - le compte client est ensuite bloque temporairement (gere hors de ce calcul)
 */
export function computeSavingsPenalty(savedAmount: number): SavingsPenalty {
  return {
    penaltyAmount: round2(savedAmount * SAVINGS_PENALTY_RATE),
    refundAmount: round2(savedAmount * SAVINGS_REFUND_RATE),
  };
}

// ------------------------------------------------------------------
// CREDIT BANCAIRE
// ------------------------------------------------------------------

/**
 * Duree maximale autorisee (en mois) pour un Credit Bancaire selon le prix de l'article :
 *  - 0 a 50 000 FCFA : 8 mois
 *  - 50 000 a 100 000 FCFA : 12 mois
 *  - au-dela : +6 mois par tranche entamee de 50 000 FCFA, arrondi vers le haut
 */
export function computeMaxCreditDurationMonths(articlePrice: number): number {
  if (articlePrice <= 0) {
    throw new Error("Le prix de l'article doit etre positif");
  }

  if (articlePrice <= AMOUNT_TIER_1_MAX) {
    return CREDIT_TIER_1_MAX_MONTHS;
  }

  if (articlePrice <= AMOUNT_TIER_2_MAX) {
    return CREDIT_TIER_2_MAX_MONTHS;
  }

  const amountAboveTier2 = articlePrice - AMOUNT_TIER_2_MAX;
  const extraBrackets = Math.ceil(amountAboveTier2 / CREDIT_BRACKET_SIZE);

  return CREDIT_TIER_2_MAX_MONTHS + extraBrackets * CREDIT_EXTRA_MONTHS_PER_BRACKET;
}

/** Le Backend est seul responsable de la validation de duree ; il ne fait jamais confiance au Front. */
export function assertValidCreditDuration(articlePrice: number, requestedMonths: number): void {
  const maxAllowed = computeMaxCreditDurationMonths(articlePrice);

  if (requestedMonths <= 0 || requestedMonths > maxAllowed) {
    throw new Error(
      `Duree de credit invalide : ${requestedMonths} mois demandes, maximum autorise ${maxAllowed} mois pour ${articlePrice} FCFA`
    );
  }
}

export interface CreditWireDetails {
  bankCommissionAmount: number;
  totalAmountToWire: number;
}

/** Montant que la Banque doit virer a NanaPay = prix article + 2% (commission NanaPay). */
export function computeBankWireAmount(articlePrice: number): CreditWireDetails {
  const bankCommissionAmount = round2(articlePrice * CREDIT_BANK_WIRE_COMMISSION_RATE);
  return {
    bankCommissionAmount,
    totalAmountToWire: round2(articlePrice + bankCommissionAmount),
  };
}

export interface CreditMerchantPayout {
  commissionRate: number;
  commissionAmount: number;
  netAmountPaid: number;
}

/**
 * Montant reverse au commercant apres validation du Credit Bancaire :
 * commission NanaPay de 4% calculee sur le prix de l'article (pas sur le montant vire par la banque).
 * La part issue de l'interet bancaire est geree separement (revenu banque, hors reversement commercant).
 */
export function computeCreditMerchantPayout(articlePrice: number): CreditMerchantPayout {
  const commissionAmount = round2(articlePrice * CREDIT_MERCHANT_COMMISSION_RATE);
  return {
    commissionRate: CREDIT_MERCHANT_COMMISSION_RATE,
    commissionAmount,
    netAmountPaid: round2(articlePrice - commissionAmount),
  };
}

// ------------------------------------------------------------------
// UTILITAIRES
// ------------------------------------------------------------------

/** Arrondi a 2 decimales pour eviter les erreurs de virgule flottante sur les montants FCFA. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
