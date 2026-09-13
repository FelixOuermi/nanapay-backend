import { randomBytes } from "crypto";

/**
 * Genere un token QR unique et difficile a deviner (256 bits d'entropie), a usage
 * controle : stocke dans orders.qr_code_token, invalide des la premiere utilisation
 * (le scan reussi passe la commande a LIVRE, ce qui empeche tout double scan).
 */
export function generateQrToken(): string {
  return randomBytes(32).toString("hex");
}
