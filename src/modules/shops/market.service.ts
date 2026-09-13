import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";

interface SearchShopsFilters {
  city?: string;
  township?: string;
  search?: string;
}

export async function searchShops(filters: SearchShopsFilters) {
  return prisma.shop.findMany({
    where: {
      city: filters.city ? { equals: filters.city, mode: "insensitive" } : undefined,
      township: filters.township ? { equals: filters.township, mode: "insensitive" } : undefined,
      shopName: filters.search ? { contains: filters.search, mode: "insensitive" } : undefined,
    },
    select: {
      id: true,
      shopName: true,
      city: true,
      township: true,
      neighborhood: true,
      addressDescription: true,
    },
    orderBy: { shopName: "asc" },
  });
}

export async function listShopProducts(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) {
    throw AppError.notFound("Boutique introuvable");
  }

  const products = await prisma.product.findMany({
    where: { shopId, isVisible: true },
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      remainingStock: true,
      media: { select: { id: true, mediaUrl: true, mediaType: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { shop: { id: shop.id, shopName: shop.shopName, city: shop.city, township: shop.township }, products };
}
