import { z } from "zod";

export const bankCreditIdParamSchema = z.object({
  id: z.string().min(1),
});

export const rejectCreditSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
