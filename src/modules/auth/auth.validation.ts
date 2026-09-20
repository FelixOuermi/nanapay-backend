import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caracteres")
  .max(72, "Le mot de passe ne doit pas depasser 72 caracteres");

const commonFields = {
  email: z.string().email().toLowerCase(),
  password: passwordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
};

const clientRegistration = z.object({
  ...commonFields,
  role: z.literal("CLIENT"),
  phoneNumber: z.string().min(8),
  cityId: z.string().min(1),
  communeId: z.string().min(1),
});

const merchantRegistration = z.object({
  ...commonFields,
  role: z.literal("MERCHANT"),
  ifuRccmNumber: z.string().min(1),
  orangeMoneyNumber: z.string().min(8).optional(),
  corisMoneyNumber: z.string().min(8).optional(),
  defaultPayoutChannel: z.enum(["ORANGE_MONEY", "CORIS_MONEY"]),
});

// Les roles BANK et ADMIN n'ont pas d'inscription publique : ils sont provisionnes hors API.
export const registerSchema = z.discriminatedUnion("role", [clientRegistration, merchantRegistration]);

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export const logoutSchema = z.object({ refreshToken: z.string().min(1) });
export const recoverySchema = z.object({ email: z.string().email().toLowerCase() });

export const updateMeSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phoneNumber: z.string().min(8).optional(),
    cityId: z.string().min(1).optional(),
    communeId: z.string().min(1).optional(),
    orangeMoneyNumber: z.string().min(8).optional(),
    corisMoneyNumber: z.string().min(8).optional(),
    defaultPayoutChannel: z.enum(["ORANGE_MONEY", "CORIS_MONEY"]).optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((v) => !v.newPassword || v.currentPassword, {
    message: "currentPassword est requis pour changer le mot de passe",
    path: ["currentPassword"],
  });
