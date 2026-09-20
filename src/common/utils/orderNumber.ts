// Numero de commande lisible pour l'UI, ex. NP-2026-00001245 (cahier, section 2).
export function formatOrderNumber(seq: number, createdAt: Date = new Date()): string {
  return `NP-${createdAt.getUTCFullYear()}-${String(seq).padStart(8, "0")}`;
}
