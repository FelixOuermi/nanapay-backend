import { z } from "zod";

// Correspond exactement au format genere par common/middleware/upload.ts
// (randomUUID + extension). Rejette toute tentative de path traversal ou de nom exotique.
export const documentFilenameParamSchema = z.object({
  filename: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$/i),
});
