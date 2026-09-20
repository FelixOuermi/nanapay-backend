import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "@common/middleware/auth";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { AppError } from "@common/errors/AppError";
import { paginationQuerySchema, sendData, sendPage, toSkipTake } from "@common/utils/response";
import { listUserNotifications, markNotificationRead } from "@services/notification/notificationService";

// Notifications de l'acteur connecte (tous roles). Pas de temps reel : le frontend
// interroge cet endpoint (polling controle), cf. cahier section 8.
export const notificationRouter = Router();

notificationRouter.use(requireAuth);

const query = paginationQuerySchema.extend({ unread: z.enum(["true", "false"]).optional() });

notificationRouter.get(
  "/",
  validate({ query }),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, unread } = req.query as unknown as { page: number; limit: number; unread?: string };
    const { skip, take } = toSkipTake({ page, limit });
    const { items, total } = await listUserNotifications(req.user!.id, skip, take, unread === "true");
    sendPage(res, items, { page, limit }, total);
  })
);

notificationRouter.patch(
  "/:id/read",
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!(await markNotificationRead(req.user!.id, req.params.id))) {
      throw AppError.notFound("Notification introuvable");
    }
    sendData(res, { id: req.params.id, isRead: true });
  })
);
