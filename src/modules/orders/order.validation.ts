import { z } from "zod";

export const createOrderSchema = z.object({
  productId: z.string().min(1),
  paymentMode: z.enum(["EPARGNE", "CREDIT_BANCAIRE"]),
});

export const extendSavingsSchema = z.object({
  months: z.coerce.number().int().min(1).max(2),
});

export const orderIdParamSchema = z.object({
  id: z.string().min(1),
});
