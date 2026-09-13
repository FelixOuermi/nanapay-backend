// Constantes financieres NanaPay - SOURCE UNIQUE DE VERITE.
// Aucune valeur (taux, seuil, duree) ne doit etre recopiee en dur ailleurs dans le code :
// les controleurs et services appellent financialService.ts, qui s'appuie sur ce fichier.

export const AMOUNT_TIER_1_MAX = 50_000; // FCFA
export const AMOUNT_TIER_2_MAX = 100_000; // FCFA

// ------------------------------------------------------------------
// EPARGNE - versement minimum et duree maximale par palier de prix
// ------------------------------------------------------------------
export const SAVINGS_TIERS = [
  { maxAmount: AMOUNT_TIER_1_MAX, minInstallment: 1_000, maxDurationMonths: 8 },
  { maxAmount: AMOUNT_TIER_2_MAX, minInstallment: 2_000, maxDurationMonths: 18 },
  { maxAmount: Infinity, minInstallment: 5_000, maxDurationMonths: 36 },
] as const;

export const SAVINGS_EXTENSION_MAX_MONTHS = 2;

// Regle actuelle (confirmee) : penalite de 15% en cas de depassement definitif du delai
// (delai de base + extension), remboursement des 85% restants, puis blocage temporaire
// du compte. L'ancienne regle 30%/70% presente dans le document initial est obsolete.
export const SAVINGS_PENALTY_RATE = 0.15;
export const SAVINGS_REFUND_RATE = 0.85;

// Commission NanaPay (HT) sur le reversement Epargne au commercant, degressive par palier.
export const SAVINGS_COMMISSION_RATE_TIER_1 = 0.08; // < 50 000 FCFA
export const SAVINGS_COMMISSION_RATE_TIER_2 = 0.05; // 50 000 - 100 000 FCFA
export const SAVINGS_COMMISSION_RATE_TIER_3 = 0.03; // >= 100 000 FCFA

// ------------------------------------------------------------------
// CREDIT BANCAIRE - duree maximale par palier de prix
// ------------------------------------------------------------------
export const CREDIT_TIER_1_MAX_MONTHS = 8; // 0 - 50 000 FCFA
export const CREDIT_TIER_2_MAX_MONTHS = 12; // 50 000 - 100 000 FCFA
export const CREDIT_EXTRA_MONTHS_PER_BRACKET = 6; // +6 mois par tranche de 50 000 FCFA au-dela
export const CREDIT_BRACKET_SIZE = 50_000;

// Virement Banque -> NanaPay : prix article + 2% (frais NanaPay factures a la banque).
export const CREDIT_BANK_WIRE_COMMISSION_RATE = 0.02;

// Commission NanaPay prelevee cote commercant sur un achat Credit Bancaire.
export const CREDIT_MERCHANT_COMMISSION_RATE = 0.04;
