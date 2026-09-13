import { OrderStatus } from "@prisma/client";
import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";

interface ShopInput {
  shopName: string;
  city: string;
  township: string;
  neighborhood: string;
  addressDescription?: string;
}

export async function createShop(merchantId: string, input: ShopInput) {
  const existing = await prisma.shop.findUnique({ where: { merchantId } });
  if (existing) {
    throw AppError.conflict("Une boutique existe deja pour ce commercant, utilisez PUT /merchant/shop");
  }

  return prisma.shop.create({ data: { merchantId, ...input } });
}

export async function updateShop(merchantId: string, input: ShopInput) {
  const existing = await prisma.shop.findUnique({ where: { merchantId } });
  if (!existing) {
    throw AppError.notFound("Aucune boutique a mettre a jour, creez-la d'abord via POST /merchant/shop");
  }

  return prisma.shop.update({ where: { merchantId }, data: input });
}

interface CreateProductInput {
  title: string;
  description?: string;
  price: number;
  initialStock: number;
}

async function getOwnShopOrThrow(merchantId: string) {
  const shop = await prisma.shop.findUnique({ where: { merchantId } });
  if (!shop) {
    throw AppError.badRequest("Creez d'abord votre boutique via POST /merchant/shop");
  }
  return shop;
}

export async function createProduct(merchantId: string, input: CreateProductInput) {
  const shop = await getOwnShopOrThrow(merchantId);

  return prisma.product.create({
    data: {
      shopId: shop.id,
      title: input.title,
      description: input.description,
      price: input.price,
      initialStock: input.initialStock,
      remainingStock: input.initialStock,
      // Un article sans stock n'a rien a faire dans le Market des sa creation.
      isVisible: input.initialStock > 0,
    },
  });
}

interface UpdateProductInput {
  title?: string;
  description?: string;
  price?: number;
  remainingStock?: number;
}

async function getOwnProductOrThrow(merchantId: string, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { shop: true },
  });

  // 404 (pas 403) pour ne pas confirmer a un commercant l'existence du produit d'un autre.
  if (!product || product.shop.merchantId !== merchantId) {
    throw AppError.notFound("Article introuvable");
  }

  return product;
}

export async function updateProduct(merchantId: string, productId: string, input: UpdateProductInput) {
  await getOwnProductOrThrow(merchantId, productId);

  return prisma.product.update({
    where: { id: productId },
    data: {
      title: input.title,
      description: input.description,
      price: input.price,
      remainingStock: input.remainingStock,
      // Le quota disponible pilote automatiquement la visibilite dans le Market.
      ...(input.remainingStock !== undefined ? { isVisible: input.remainingStock > 0 } : {}),
    },
  });
}

interface AddProductMediaInput {
  photoUrls: string[];
  spotUrls: string[];
}

export async function addProductMedia(merchantId: string, productId: string, input: AddProductMediaInput) {
  await getOwnProductOrThrow(merchantId, productId);

  const mediaRows = [
    ...input.photoUrls.map((mediaUrl) => ({ productId, mediaUrl, mediaType: "PHOTO" as const })),
    ...input.spotUrls.map((mediaUrl) => ({ productId, mediaUrl, mediaType: "SPOT_PUB" as const })),
  ];

  if (mediaRows.length === 0) {
    throw AppError.badRequest("Aucun fichier recu (champs attendus: photos, spots)");
  }

  await prisma.productMedia.createMany({ data: mediaRows });

  return prisma.productMedia.findMany({ where: { productId } });
}

// Sans filtre explicite : "ventes en cours et commandes pretes" (cf. cahier, section 7).
const DEFAULT_ORDER_STATUSES: OrderStatus[] = ["EN_COURS", "PRET_A_LIVRER"];

export async function listMerchantOrders(merchantId: string, status?: OrderStatus) {
  return prisma.order.findMany({
    where: {
      product: { shop: { merchantId } },
      status: status ?? { in: DEFAULT_ORDER_STATUSES },
    },
    include: {
      product: { select: { title: true, price: true } },
      client: { select: { firstName: true, lastName: true, phoneNumber: true } },
      savingsPlan: { select: { currentSavedAmount: true, targetAmount: true, dueDate: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
