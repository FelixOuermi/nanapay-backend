import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { AppError } from "@common/errors/AppError";
import { PageParams, toSkipTake } from "@common/utils/response";
import { recordAudit } from "@services/audit/auditService";

interface StoreInput {
  name: string;
  cityId: string;
  communeId: string;
  addressDescription?: string;
}

// Un commercant non valide par l'Admin ne peut ni ouvrir de boutique ni publier de produit.
async function getValidatedMerchant(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, include: { store: true } });
  if (!merchant) {
    throw AppError.notFound("Commercant introuvable");
  }
  if (merchant.status !== "VALIDE") {
    throw AppError.forbidden("Votre compte commercant doit etre valide par l'Admin avant cette operation");
  }
  return merchant;
}

async function assertLocation(cityId: string, communeId: string) {
  const commune = await prisma.commune.findUnique({ where: { id: communeId } });
  if (!commune || commune.cityId !== cityId) {
    throw AppError.badRequest("Ville ou commune invalide");
  }
}

export async function createStore(merchantId: string, input: StoreInput) {
  const merchant = await getValidatedMerchant(merchantId);
  if (merchant.store) {
    throw AppError.conflict("Ce commercant possede deja une boutique");
  }
  await assertLocation(input.cityId, input.communeId);

  const store = await prisma.store.create({ data: { merchantId, ...input } });
  await recordAudit({ action: "STORE_CREATED", entityType: "store", entityId: store.id, actorRole: "MERCHANT" });
  return store;
}

export async function updateStore(merchantId: string, input: StoreInput) {
  const merchant = await getValidatedMerchant(merchantId);
  if (!merchant.store) {
    throw AppError.notFound("Aucune boutique a mettre a jour");
  }
  await assertLocation(input.cityId, input.communeId);

  return prisma.store.update({ where: { id: merchant.store.id }, data: input });
}

export async function getMyStore(merchantId: string) {
  const store = await prisma.store.findUnique({
    where: { merchantId },
    include: { city: true, commune: true, products: { where: { deletedAt: null }, include: { media: true } } },
  });
  if (!store) {
    throw AppError.notFound("Aucune boutique");
  }
  return store;
}

async function requireStore(merchantId: string) {
  const merchant = await getValidatedMerchant(merchantId);
  if (!merchant.store) {
    throw AppError.badRequest("Creez d'abord votre boutique");
  }
  return merchant.store;
}

async function getOwnProductOrThrow(merchantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, store: { merchantId } },
  });
  // 404 (pas 403) : ne confirme pas l'existence du produit d'un autre commercant.
  if (!product) {
    throw AppError.notFound("Produit introuvable");
  }
  return product;
}

interface CreateProductInput {
  title: string;
  description?: string;
  price: number;
  stock: number;
  isPublished?: boolean;
}

export async function createProduct(merchantId: string, input: CreateProductInput) {
  const store = await requireStore(merchantId);
  const product = await prisma.product.create({
    data: { storeId: store.id, ...input, isPublished: input.isPublished ?? true },
  });

  await recordAudit({
    action: "PRODUCT_CREATED",
    entityType: "product",
    entityId: product.id,
    actorRole: "MERCHANT",
    amount: product.price,
  });
  return product;
}

export async function updateProduct(
  merchantId: string,
  productId: string,
  input: { title?: string; description?: string; stock?: number; isPublished?: boolean }
) {
  await getValidatedMerchant(merchantId);
  await getOwnProductOrThrow(merchantId, productId);
  return prisma.product.update({ where: { id: productId }, data: input });
}

const OPEN_ORDER_STATUSES: OrderStatus[] = ["CREEE", "FINANCEMENT_EN_COURS", "FINANCEE", "PRETE_A_LIVRER", "LIVREE"];

/**
 * Suppression selon les regles : impossible tant qu'une commande non terminee reference
 * le produit (le client a un financement en cours ou un retrait a effectuer). Sinon,
 * suppression logique : l'historique des commandes terminees reste intact.
 */
export async function deleteProduct(merchantId: string, productId: string) {
  await getValidatedMerchant(merchantId);
  await getOwnProductOrThrow(merchantId, productId);

  const openOrders = await prisma.order.count({
    where: { productId, status: { in: OPEN_ORDER_STATUSES }, cancelledAt: null },
  });
  if (openOrders > 0) {
    throw AppError.conflict(`Suppression impossible : ${openOrders} commande(s) en cours sur ce produit`);
  }

  await prisma.product.update({ where: { id: productId }, data: { deletedAt: new Date(), isPublished: false } });
  await recordAudit({ action: "PRODUCT_DELETED", entityType: "product", entityId: productId, actorRole: "MERCHANT" });
}

export async function addProductMedia(
  merchantId: string,
  productId: string,
  files: { filename: string; type: "PHOTO" | "SPOT_PUB" }[]
) {
  await getOwnProductOrThrow(merchantId, productId);
  if (files.length === 0) {
    throw AppError.badRequest("Aucun fichier fourni");
  }

  await prisma.productMedia.createMany({
    data: files.map((file) => ({ productId, mediaUrl: `/media/${file.filename}`, mediaType: file.type })),
  });
  return prisma.productMedia.findMany({ where: { productId } });
}

export async function listMerchantOrders(merchantId: string, page: PageParams, status?: OrderStatus) {
  const where: Prisma.OrderWhereInput = { store: { merchantId }, ...(status ? { status } : {}) };

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        product: { select: { id: true, title: true } },
        client: { select: { firstName: true, lastName: true, phoneNumber: true } },
        settlement: { select: { status: true, netAmount: true } },
      },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(page),
    }),
    prisma.order.count({ where }),
  ]);

  return { items, total };
}

export async function listSettlements(merchantId: string, page: PageParams) {
  const [items, total] = await Promise.all([
    prisma.merchantSettlement.findMany({
      where: { merchantId },
      include: { order: { select: { orderNumber: true, product: { select: { title: true } } } } },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(page),
    }),
    prisma.merchantSettlement.count({ where: { merchantId } }),
  ]);
  return { items, total };
}
