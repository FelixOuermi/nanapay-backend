import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { env } from "@config/env";
import { AccessTokenPayload } from "@common/middleware/auth";
import { parseDurationMs } from "./duration";

export function generateAccessToken(payload: AccessTokenPayload): string {
  // Duree passee en secondes (nombre) plutot qu'en chaine : evite de dependre du format
  // StringValue restreint de jsonwebtoken/ms, tout en reutilisant notre propre parseur.
  const expiresInSeconds = parseDurationMs(env.JWT_ACCESS_EXPIRES_IN) / 1000;
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: expiresInSeconds });
}

/**
 * Le refresh token est une valeur opaque (non-JWT) : seul son empreinte SHA-256 est
 * stockee en base (table refresh_tokens), jamais la valeur en clair. Cela permet de le
 * revoquer immediatement (logout, rotation) sans dependre de l'expiration du JWT.
 */
export function generateOpaqueRefreshToken(): string {
  return randomBytes(40).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
