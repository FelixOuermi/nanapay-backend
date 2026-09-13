import { Router } from "express";
import { authRouter } from "@modules/auth/auth.routes";
import { clientRouter } from "@modules/clients/client.routes";
import { marketRouter } from "@modules/shops/market.routes";
import { orderRouter } from "@modules/orders/order.routes";
import { merchantRouter } from "@modules/merchants/merchant.routes";
import { bankRouter } from "@modules/bank/bank.routes";
import { adminRouter } from "@modules/admin/admin.routes";
import { webhookRouter } from "@modules/webhooks/webhook.routes";
import { documentRouter } from "@modules/documents/document.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/client", clientRouter);
apiRouter.use(marketRouter); // expose /market/shops et /shops/:id/products
apiRouter.use("/orders", orderRouter);
apiRouter.use("/merchant", merchantRouter);
apiRouter.use("/bank", bankRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/webhooks", webhookRouter);
apiRouter.use("/documents", documentRouter);
