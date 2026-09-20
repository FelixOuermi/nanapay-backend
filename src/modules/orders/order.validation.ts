import { z } from "zod";
import { paginationQuerySchema } from "@common/utils/response";

export const createOrderSchema = z.object({
  productId: z.string().min(1),
});

export const selectFinancingSchema = z.object({
  mode: z.enum(["SAVINGS", "VAULT", "CREDIT"]),
});

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["CREEE", "FINANCEMENT_EN_COURS", "FINANCEE", "PRETE_A_LIVRER", "LIVREE", "TERMINEE"]).optional(),
});

export const orderIdParamSchema = z.object({ id: z.string().min(1) });
