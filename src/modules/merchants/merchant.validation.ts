import { z } from "zod";

export const shopSchema = z.object({
  shopName: z.string().min(1),
  city: z.string().min(1),
  township: z.string().min(1),
  neighborhood: z.string().min(1),
  addressDescription: z.string().max(1000).optional(),
});

export const createProductSchema = z.object({
  title: z.string().min(1),
  description: z.string().max(2000).optional(),
  price: z.coerce.number().positive(),
  initialStock: z.coerce.number().int().nonnegative(),
});

export const updateProductSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().max(2000).optional(),
    price: z.coerce.number().positive().optional(),
    remainingStock: z.coerce.number().int().nonnegative().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Au moins un champ doit etre fourni",
  });

export const productIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listMerchantOrdersQuerySchema = z.object({
  status: z.enum(["EN_COURS", "PRET_A_LIVRER", "LIVRE", "ECHEC_PENALISE", "ANNULE"]).optional(),
});
