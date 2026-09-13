import { MobileMoneyOperator } from "@prisma/client";
import { PaymentProvider } from "./PaymentProvider";
import { OrangeMoneyProvider } from "./OrangeMoneyProvider";
import { CorisMoneyProvider } from "./CorisMoneyProvider";

const orangeMoneyProvider = new OrangeMoneyProvider();
const corisMoneyProvider = new CorisMoneyProvider();

export function getPaymentProvider(operator: MobileMoneyOperator): PaymentProvider {
  switch (operator) {
    case "ORANGE_MONEY":
      return orangeMoneyProvider;
    case "CORIS_MONEY":
      return corisMoneyProvider;
    default: {
      const exhaustiveCheck: never = operator;
      throw new Error(`Operateur Mobile Money non supporte: ${exhaustiveCheck}`);
    }
  }
}
