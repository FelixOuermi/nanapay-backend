import { z } from "zod";

export const scanQrSchema = z.object({
  qrCodeToken: z.string().min(1),
});

export const orderIdParamSchema = z.object({
  id: z.string().min(1),
});
