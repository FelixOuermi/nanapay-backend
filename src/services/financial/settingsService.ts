import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { DEFAULT_FINANCIAL_PARAMS, FinancialParams } from "./financial.constants";

export const FINANCIAL_SETTINGS_KEY = "financial.params";

const rate = z.number().min(0).max(1);
const positiveInt = z.number().int().positive();

export const financialParamsSchema = z.object({
  savingsTiers: z
    .array(
      z.object({
        maxAmount: positiveInt.nullable(),
        minInstallment: positiveInt,
        maxDurationMonths: positiveInt,
      })
    )
    .min(1),
  savingsExtensionMaxMonths: z.number().int().min(0),
  savingsPenaltyRate: rate,
  savingsCommissionRates: z.object({ tier1: rate, tier2: rate, tier3: rate }),
  creditTier1MaxMonths: positiveInt,
  creditTier2MaxMonths: positiveInt,
  creditExtraMonthsPerBracket: positiveInt,
  creditBracketSize: positiveInt,
  creditBankFeeRate: rate,
  creditMerchantCommissionRate: rate,
  qrTtlHours: positiveInt,
});

export const financialParamsPatchSchema = financialParamsSchema.partial().strict();

const CACHE_TTL_MS = 30_000;
let cache: { value: FinancialParams; expiresAt: number } | null = null;

/** Parametres financiers effectifs : valeurs par defaut surchargees par le back-office. */
export async function getFinancialParams(): Promise<FinancialParams> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const row = await prisma.setting.findUnique({ where: { key: FINANCIAL_SETTINGS_KEY } });
  const parsed = financialParamsPatchSchema.safeParse(row?.value ?? {});
  const value: FinancialParams = { ...DEFAULT_FINANCIAL_PARAMS, ...(parsed.success ? parsed.data : {}) };

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function updateFinancialParams(
  patch: z.infer<typeof financialParamsPatchSchema>,
  updatedBy: string
): Promise<FinancialParams> {
  const current = await getFinancialParams();
  const next: FinancialParams = { ...current, ...patch };

  await prisma.setting.upsert({
    where: { key: FINANCIAL_SETTINGS_KEY },
    create: { key: FINANCIAL_SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue, updatedBy },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedBy },
  });

  cache = null;
  return next;
}

export function resetFinancialParamsCache(): void {
  cache = null;
}
