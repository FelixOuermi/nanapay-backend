jest.mock("@config/prisma", () => ({
  prisma: {
    shop: { findMany: jest.fn(), findUnique: jest.fn() },
    product: { findMany: jest.fn() },
  },
}));

import { prisma } from "@config/prisma";
import * as marketService from "@modules/shops/market.service";

const mockedPrisma = prisma as unknown as {
  shop: { findMany: jest.Mock; findUnique: jest.Mock };
  product: { findMany: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("market.service - searchShops", () => {
  it("transmet les filtres ville/commune/recherche a Prisma", async () => {
    mockedPrisma.shop.findMany.mockResolvedValueOnce([]);

    await marketService.searchShops({ city: "Ouaga", township: "Baskuy", search: "quincaillerie" });

    const args = mockedPrisma.shop.findMany.mock.calls[0][0];
    expect(args.where.city).toEqual({ equals: "Ouaga", mode: "insensitive" });
    expect(args.where.township).toEqual({ equals: "Baskuy", mode: "insensitive" });
    expect(args.where.shopName).toEqual({ contains: "quincaillerie", mode: "insensitive" });
  });
});

describe("market.service - listShopProducts", () => {
  it("rejette une boutique inconnue", async () => {
    mockedPrisma.shop.findUnique.mockResolvedValueOnce(null);

    await expect(marketService.listShopProducts("shop-x")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("ne remonte que les articles visibles de la boutique", async () => {
    mockedPrisma.shop.findUnique.mockResolvedValueOnce({
      id: "shop-1",
      shopName: "Ma boutique",
      city: "Ouaga",
      township: "Baskuy",
    });
    mockedPrisma.product.findMany.mockResolvedValueOnce([]);

    await marketService.listShopProducts("shop-1");

    const args = mockedPrisma.product.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ shopId: "shop-1", isVisible: true });
  });
});
