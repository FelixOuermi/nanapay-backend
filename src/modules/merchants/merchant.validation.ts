import { z } from "zod";
import { paginationQuerySchema } from "@common/utils/response";

export const storeSchema = z.object({
  name: z.string().min(1),
  cityId: z.string().min(1),
  communeId: z.string().min(1),
  addressDescription: z.string().optional(),
});

// FCFA entier uniquement, jamais de flottant.
const fcfa = z.number().int().positive();

export const createProductSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  price: fcfa,
  stock: z.number().int().min(0),
  isPublished: z.boolean().optional(),
});

// Le prix d'un produit publie est definitif (cahier, section 6) : .strict() fait rejeter
// toute tentative de modification de `price` (ou de champ inconnu) avec une 422.
export const updateProductSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    stock: z.number().int().min(0).optional(),
    isPublished: z.boolean().optional(),
  })
  .strict();

export const productIdParamSchema = z.object({ id: z.string().min(1) });

export const listMerchantOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["CREEE", "FINANCEMENT_EN_COURS", "FINANCEE", "PRETE_A_LIVRER", "LIVREE", "TERMINEE"]).optional(),
});

export const scanQrSchema = z.object({ qrToken: z.string().min(1) });
export const orderIdParamSchema = z.object({ id: z.string().min(1) });
