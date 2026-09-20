import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { PageParams, toSkipTake } from "@common/utils/response";

// Un produit n'est visible sur la marketplace que s'il est publie, non supprime, en stock,
// et que la boutique appartient a un commercant valide.
const VISIBLE_PRODUCT: Prisma.ProductWhereInput = {
  isPublished: true,
  deletedAt: null,
  stock: { gt: 0 },
};

const PRODUCT_PUBLIC_SELECT = {
  id: true,
  storeId: true,
  title: true,
  description: true,
  price: true,
  stock: true,
  media: { select: { id: true, mediaUrl: true, mediaType: true } },
} as const;

export function listCities() {
  return prisma.city.findMany({ orderBy: { name: "asc" } });
}

export function listCommunes(cityId: string) {
  return prisma.commune.findMany({ where: { cityId }, orderBy: { name: "asc" } });
}

interface StoreFilters {
  cityId?: string;
  communeId?: string;
}

export async function listStores(filters: StoreFilters, page: PageParams) {
  const where: Prisma.StoreWhereInput = {
    merchant: { status: "VALIDE" },
    ...(filters.cityId ? { cityId: filters.cityId } : {}),
    ...(filters.communeId ? { communeId: filters.communeId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.store.findMany({
      where,
      include: { city: true, commune: true, _count: { select: { products: { where: VISIBLE_PRODUCT } } } },
      orderBy: { name: "asc" },
      ...toSkipTake(page),
    }),
    prisma.store.count({ where }),
  ]);

  return { items, total };
}

export async function getStore(storeId: string) {
  const store = await prisma.store.findFirst({
    where: { id: storeId, merchant: { status: "VALIDE" } },
    include: {
      city: true,
      commune: true,
      products: { where: VISIBLE_PRODUCT, select: PRODUCT_PUBLIC_SELECT, orderBy: { createdAt: "desc" } },
    },
  });

  if (!store) {
    throw AppError.notFound("Boutique introuvable");
  }
  return store;
}

export async function getProduct(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, ...VISIBLE_PRODUCT, store: { merchant: { status: "VALIDE" } } },
    select: { ...PRODUCT_PUBLIC_SELECT, store: { select: { id: true, name: true, cityId: true, communeId: true } } },
  });

  if (!product) {
    throw AppError.notFound("Produit introuvable");
  }
  return product;
}
