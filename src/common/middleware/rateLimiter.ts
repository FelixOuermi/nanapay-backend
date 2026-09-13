import rateLimit from "express-rate-limit";
import { env } from "@config/env";

const TOO_MANY_REQUESTS_RESPONSE = {
  error: { code: "TOO_MANY_REQUESTS", message: "Trop de tentatives, reessayez plus tard" },
};

// Applique sur /auth/login, /auth/register/*, /auth/recovery : le plus strict, car ce
// sont les cibles naturelles du bruteforce/credential-stuffing.
export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_AUTH,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS_RESPONSE,
});

// Applique aux actions mutantes sensibles hors auth : approbations/rejets Admin et
// Banque, virements, reversements (cf. cahier, section 14 : "Rate limiting sur
// authentification ET endpoints sensibles").
export const sensitiveActionRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_SENSITIVE,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS_RESPONSE,
});

// Applique aux webhooks Mobile Money : plus permissif (un fournisseur peut legitimement
// emettre beaucoup d'evenements), mais toujours borne contre un flood.
export const webhookRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_WEBHOOK,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS_RESPONSE,
});
