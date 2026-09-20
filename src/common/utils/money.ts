// Montants FCFA : toujours des entiers, jamais de flottant (cahier, section 8).
export function roundFcfa(value: number): number {
  return Math.round(value);
}

export function isFcfaInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
