import { OrderStatus } from "@prisma/client";
import { AppError } from "@common/errors/AppError";

// Machine d'etat de la commande (cahier, section 3) :
// CREEE -> FINANCEMENT_EN_COURS -> FINANCEE -> PRETE_A_LIVRER -> LIVREE -> TERMINEE.
// CREEE est aussi atteignable depuis FINANCEMENT_EN_COURS quand un credit est refuse
// (le client peut alors choisir un autre mode de financement).
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREEE: ["FINANCEMENT_EN_COURS"],
  FINANCEMENT_EN_COURS: ["FINANCEE", "CREEE"],
  FINANCEE: ["PRETE_A_LIVRER"],
  PRETE_A_LIVRER: ["LIVREE"],
  LIVREE: ["TERMINEE"],
  TERMINEE: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw AppError.conflict(`Transition de commande interdite : ${from} -> ${to}`);
  }
}
