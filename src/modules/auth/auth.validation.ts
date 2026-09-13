import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caracteres")
  .max(72, "Le mot de passe ne doit pas depasser 72 caracteres");

export const registerClientSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phoneNumber: z.string().min(8),
  city: z.string().min(1),
  township: z.string().min(1),
  sector: z.string().min(1),
});

export const registerMerchantSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  ifuRccmNumber: z.string().min(1),
  city: z.string().min(1),
  orangeMoneyNumber: z.string().min(8).optional(),
  corisMoneyNumber: z.string().min(8).optional(),
  defaultPayoutAccount: z.enum(["ORANGE_MONEY", "CORIS_MONEY"]),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const recoverySchema = z.object({
  email: z.string().email(),
});
