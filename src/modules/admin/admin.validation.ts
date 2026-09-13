import { z } from "zod";

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export const rejectAccountSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
