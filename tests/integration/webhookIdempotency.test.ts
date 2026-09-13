/**
 * Test d'integration reel (vraie base, cf. cahier des taches section 15 : "Tests
 * webhook avec evenement duplique"). Verifie que deux depots strictement simultanes
 * portant la meme transaction_reference (rejeu webhook concurrent) ne sont comptes
 * qu'une seule fois, grace a la contrainte UNIQUE + au catch P2002 dans
 * savings.service.processSavingsDeposit.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@config/prisma";
import { hashPassword } from "@common/utils/password";
import { createOrder } from "@modules/orders/order.service";
import { processSavingsDeposit } from "@modules/savings/savings.service";

const RUN_ID = randomUUID().slice(0, 8);

let clientId: string;
let orderId: string;
let savingsPlanId: string;
let userIdsToCleanup: string[] = [];
let shopId: string;
let productId: string;

beforeAll(async () => {
  const passwordHash = await hashPassword("Password123!");

  const clientUser = await prisma.user.create({
    data: {
      email: `it-webhook-client-${RUN_ID}@test.com`,
      passwordHash,
      role: "CLIENT",
      isActive: true,
      accountStatus: "APPROVED",
      client: {
        create: {
          firstName: "Test",
          lastName: "Webhook",
          phoneNumber: "70000000",
          city: "Ouagadougou",
          township: "Baskuy",
          sector: "Secteur 1",
          cnibRectoUrl: "test-recto.jpg",
          cnibVersoUrl: "test-verso.jpg",
        },
      },
    },
    include: { client: true },
  });
  clientId = clientUser.client!.id;

  const merchantUser = await prisma.user.create({
    data: {
      email: `it-webhook-merchant-${RUN_ID}@test.com`,
      passwordHash,
      role: "COMMERCANT",
      isActive: true,
      accountStatus: "APPROVED",
      merchant: {
        create: {
          firstName: "Test",
          lastName: "Marchand",
          cnibRectoUrl: "test-recto.jpg",
          cnibVersoUrl: "test-verso.jpg",
          ifuRccmNumber: `IFU-WH-${RUN_ID}`,
          city: "Ouagadougou",
          defaultPayoutAccount: "ORANGE_MONEY",
        },
      },
    },
    include: { merchant: true },
  });

  userIdsToCleanup = [clientUser.id, merchantUser.id];

  const shop = await prisma.shop.create({
    data: {
      merchantId: merchantUser.merchant!.id,
      shopName: `Boutique Webhook Test ${RUN_ID}`,
      city: "Ouagadougou",
      township: "Baskuy",
      neighborhood: "Secteur 4",
    },
  });
  shopId = shop.id;

  const product = await prisma.product.create({
    data: {
      shopId: shop.id,
      title: `Article Webhook Test ${RUN_ID}`,
      price: 30_000,
      initialStock: 5,
      remainingStock: 5,
      isVisible: true,
    },
  });
  productId = product.id;

  const order = (await createOrder(clientId, { productId, paymentMode: "EPARGNE" })) as unknown as {
    id: string;
    savingsPlan: { id: string };
  };
  orderId = order.id;
  savingsPlanId = order.savingsPlan.id;
});

afterAll(async () => {
  await prisma.savingsDeposit.deleteMany({ where: { savingsPlanId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.product.deleteMany({ where: { shopId } });
  await prisma.shop.deleteMany({ where: { id: shopId } });
  await prisma.user.deleteMany({ where: { id: { in: userIdsToCleanup } } });
  await prisma.$disconnect();
});

describe("Idempotence webhook (integration, vraie base)", () => {
  it("ne compte qu'une fois deux depots concurrents avec la meme transaction_reference", async () => {
    const transactionReference = `IT-DUP-${RUN_ID}`;

    const [resultA, resultB] = await Promise.all([
      processSavingsDeposit({ orderId, transactionReference, amount: 5_000, operator: "ORANGE_MONEY" }),
      processSavingsDeposit({ orderId, transactionReference, amount: 5_000, operator: "ORANGE_MONEY" }),
    ]);

    const alreadyProcessedFlags = [resultA.alreadyProcessed, resultB.alreadyProcessed].sort();
    expect(alreadyProcessedFlags).toEqual([false, true]);

    const plan = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: savingsPlanId } });
    expect(Number(plan.currentSavedAmount)).toBe(5_000);

    const deposits = await prisma.savingsDeposit.findMany({ where: { savingsPlanId } });
    expect(deposits).toHaveLength(1);
  });
});
