jest.mock("@config/prisma", () => ({
  prisma: {
    shop: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    product: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    productMedia: { createMany: jest.fn(), findMany: jest.fn() },
    order: { findMany: jest.fn() },
  },
}));

import { prisma } from "@config/prisma";
import * as merchantService from "@modules/merchants/merchant.service";

const mockedPrisma = prisma as unknown as {
  shop: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  product: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  productMedia: { createMany: jest.Mock; findMany: jest.Mock };
  order: { findMany: jest.Mock };
};

const MERCHANT_ID = "merchant-1";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("merchant.service - shop", () => {
  it("refuse de creer une deuxieme boutique pour le meme commercant", async () => {
    mockedPrisma.shop.findUnique.mockResolvedValueOnce({ id: "shop-1" });

    await expect(
      merchantService.createShop(MERCHANT_ID, {
        shopName: "Ma boutique",
        city: "Ouaga",
        township: "Baskuy",
        neighborhood: "Secteur 4",
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockedPrisma.shop.create).not.toHaveBeenCalled();
  });

  it("refuse de mettre a jour une boutique qui n'existe pas encore", async () => {
    mockedPrisma.shop.findUnique.mockResolvedValueOnce(null);

    await expect(
      merchantService.updateShop(MERCHANT_ID, {
        shopName: "Ma boutique",
        city: "Ouaga",
        township: "Baskuy",
        neighborhood: "Secteur 4",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("merchant.service - products", () => {
  it("refuse de creer un produit sans boutique", async () => {
    mockedPrisma.shop.findUnique.mockResolvedValueOnce(null);

    await expect(
      merchantService.createProduct(MERCHANT_ID, { title: "Chaise", price: 5000, initialStock: 10 })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("cree un produit visible quand le stock initial est positif", async () => {
    mockedPrisma.shop.findUnique.mockResolvedValueOnce({ id: "shop-1" });

    await merchantService.createProduct(MERCHANT_ID, { title: "Chaise", price: 5000, initialStock: 10 });

    const createArgs = mockedPrisma.product.create.mock.calls[0][0];
    expect(createArgs.data.remainingStock).toBe(10);
    expect(createArgs.data.isVisible).toBe(true);
  });

  it("cree un produit invisible quand le stock initial est nul", async () => {
    mockedPrisma.shop.findUnique.mockResolvedValueOnce({ id: "shop-1" });

    await merchantService.createProduct(MERCHANT_ID, { title: "Chaise", price: 5000, initialStock: 0 });

    const createArgs = mockedPrisma.product.create.mock.calls[0][0];
    expect(createArgs.data.isVisible).toBe(false);
  });

  it("refuse de modifier le produit d'un autre commercant (404, pas 403)", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      shop: { merchantId: "un-autre-commercant" },
    });

    await expect(
      merchantService.updateProduct(MERCHANT_ID, "product-1", { price: 6000 })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockedPrisma.product.update).not.toHaveBeenCalled();
  });

  it("masque automatiquement l'article quand le stock restant tombe a zero", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      shop: { merchantId: MERCHANT_ID },
    });

    await merchantService.updateProduct(MERCHANT_ID, "product-1", { remainingStock: 0 });

    const updateArgs = mockedPrisma.product.update.mock.calls[0][0];
    expect(updateArgs.data.isVisible).toBe(false);
  });

  it("ne touche pas a la visibilite si le stock n'est pas dans la mise a jour", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      shop: { merchantId: MERCHANT_ID },
    });

    await merchantService.updateProduct(MERCHANT_ID, "product-1", { price: 7000 });

    const updateArgs = mockedPrisma.product.update.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("isVisible");
  });
});

describe("merchant.service - product media", () => {
  it("refuse un appel sans aucun fichier", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      shop: { merchantId: MERCHANT_ID },
    });

    await expect(
      merchantService.addProductMedia(MERCHANT_ID, "product-1", { photoUrls: [], spotUrls: [] })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("enregistre les photos et les spots avec le bon mediaType", async () => {
    mockedPrisma.product.findUnique.mockResolvedValueOnce({
      id: "product-1",
      shop: { merchantId: MERCHANT_ID },
    });
    mockedPrisma.productMedia.findMany.mockResolvedValueOnce([]);

    await merchantService.addProductMedia(MERCHANT_ID, "product-1", {
      photoUrls: ["/media/a.jpg"],
      spotUrls: ["/media/b.jpg"],
    });

    const createManyArgs = mockedPrisma.productMedia.createMany.mock.calls[0][0];
    expect(createManyArgs.data).toEqual([
      { productId: "product-1", mediaUrl: "/media/a.jpg", mediaType: "PHOTO" },
      { productId: "product-1", mediaUrl: "/media/b.jpg", mediaType: "SPOT_PUB" },
    ]);
  });
});

describe("merchant.service - listMerchantOrders", () => {
  it("filtre par defaut sur EN_COURS et PRET_A_LIVRER (ventes en cours et commandes pretes)", async () => {
    mockedPrisma.order.findMany.mockResolvedValueOnce([]);

    await merchantService.listMerchantOrders(MERCHANT_ID);

    const args = mockedPrisma.order.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ["EN_COURS", "PRET_A_LIVRER"] });
    expect(args.where.product).toEqual({ shop: { merchantId: MERCHANT_ID } });
  });

  it("applique le filtre de statut explicite quand il est fourni", async () => {
    mockedPrisma.order.findMany.mockResolvedValueOnce([]);

    await merchantService.listMerchantOrders(MERCHANT_ID, "LIVRE");

    const args = mockedPrisma.order.findMany.mock.calls[0][0];
    expect(args.where.status).toBe("LIVRE");
  });
});
