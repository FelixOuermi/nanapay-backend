import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { env } from "@config/env";

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, env.BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}

/** Mot de passe temporaire envoye par e-mail apres validation Admin ou recuperation de compte. */
export function generateTemporaryPassword(): string {
  return randomBytes(9).toString("base64url"); // 12 caracteres, lisible, sans conservation en clair
}
