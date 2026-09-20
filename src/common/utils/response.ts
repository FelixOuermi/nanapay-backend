import { Response } from "express";
import { z } from "zod";

// Contrat de reponse succes : { data, meta? } (cahier, section 8).
export function sendData<T>(res: Response, data: T, status = 200, meta?: Record<string, unknown>): void {
  res.status(status).json(meta ? { data, meta } : { data });
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface PageParams {
  page: number;
  limit: number;
}

export function toSkipTake({ page, limit }: PageParams) {
  return { skip: (page - 1) * limit, take: limit };
}

// Pagination : page, limit, total, nextPage (null s'il n'y a plus de page).
export function paginationMeta({ page, limit }: PageParams, total: number) {
  return { page, limit, total, nextPage: page * limit < total ? page + 1 : null };
}

export function sendPage<T>(res: Response, items: T[], params: PageParams, total: number): void {
  sendData(res, items, 200, paginationMeta(params, total));
}
