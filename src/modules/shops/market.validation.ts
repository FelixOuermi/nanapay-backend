import { z } from "zod";

export const searchShopsQuerySchema = z.object({
  city: z.string().min(1).optional(),
  township: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
});

export const shopIdParamSchema = z.object({
  id: z.string().min(1),
});
