import { Router } from "express";
import { authRouter, meRouter } from "@modules/auth/auth.routes";
import { marketplaceRouter } from "@modules/marketplace/marketplace.routes";
import { orderRouter } from "@modules/orders/order.routes";
import { savingsRouter } from "@modules/savings/savings.routes";
import { vaultRouter } from "@modules/vaults/vault.routes";
import { creditRouter } from "@modules/credit/credit.routes";
import { merchantRouter } from "@modules/merchants/merchant.routes";
import { bankRouter } from "@modules/bank/bank.routes";
import { adminRouter } from "@modules/admin/admin.routes";
import { webhookRouter } from "@modules/payments/webhook.routes";
import { notificationRouter } from "@modules/notifications/notification.routes";
import { documentRouter } from "@modules/documents/document.routes";

// Contrat d'API du cahier (section 4), monte sous /api (et /api/v1, alias historique).
export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/me", meRouter);

// Routeurs a chemins complets : /marketplace/*, /stores/*, /products/*, /orders/:id/savings,
// /savings/*, /orders/:id/vault, /vaults/*, /credit/*, /credits/:id.
apiRouter.use(marketplaceRouter);
apiRouter.use(savingsRouter);
apiRouter.use(vaultRouter);
apiRouter.use(creditRouter);

apiRouter.use("/orders", orderRouter);
apiRouter.use("/merchant", merchantRouter);
apiRouter.use("/bank", bankRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/webhooks", webhookRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/documents", documentRouter);
