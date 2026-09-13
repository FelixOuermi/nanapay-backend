/**
 * Test d'integration reel (vraie base, cf. cahier des taches section 15 : "Tests de
 * stock concurrent"). Verifie que deux achats simultanes du dernier exemplaire d'un
 * article n'aboutissent jamais tous les deux : le decrement conditionnel de
 * order.service.createOrder doit garantir qu'un seul des deux passe.
 *
 * Necessite DATABASE_URL configuree (voir .env). Nettoie ses propres donnees a la fin.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@config/prisma";
import { hashPassword } from "@common/utils/password";
import { createOrder } from "@modules/orders/order.service";

const RUN_ID = randomUUID().slice(0, 8);

let clientId: string;
let productId: string;
let userIdsToCleanup: string[] = [];
let shopId: string;

beforeAll(async () => {
  const passwordHash = await hashPassword("Password123!");

  const clientUser = await prisma.user.create({
    data: {
      email: `it-client-${RUN_ID}@test.com`,
      passwordHash,
      role: "CLIENT",
      isActive: true,
      accountStatus: "APPROVED",
      client: {
        create: {
          firstName: "Test",
          lastName: "Integration",
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
      email: `it-merchant-${RUN_ID}@test.com`,
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
          ifuRccmNumber: `IFU-${RUN_ID}`,
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
      shopName: `Boutique Test ${RUN_ID}`,
      city: "Ouagadougou",
      township: "Baskuy",
      neighborhood: "Secteur 4",
    },
  });
  shopId = shop.id;

  const product = await prisma.product.create({
    data: {
      shopId: shop.id,
      title: `Article Test ${RUN_ID}`,
      price: 10_000,
      initialStock: 1,
      remainingStock: 1,
      isVisible: true,
    },
  });
  productId = product.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { shopId } });
  await prisma.shop.deleteMany({ where: { id: shopId } });
  await prisma.user.deleteMany({ where: { id: { in: userIdsToCleanup } } });
  await prisma.$disconnect();
});

describe("Stock concurrent (integration, vraie base)", () => {
  it("n'autorise qu'un seul des deux achats simultanes du dernier exemplaire", async () => {
    const [resultA, resultB] = await Promise.allSettled([
      createOrder(clientId, { productId, paymentMode: "EPARGNE" }),
      createOrder(clientId, { productId, paymentMode: "EPARGNE" }),
    ]);

    const outcomes = [resultA, resultB];
    const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
    const rejected = outcomes.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ statusCode: 409 });
    }

    const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(finalProduct.remainingStock).toBe(0);
    expect(finalProduct.isVisible).toBe(false);
  });
});
