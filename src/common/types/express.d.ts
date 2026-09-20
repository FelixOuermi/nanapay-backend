import { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      rawBody?: Buffer;
      user?: {
        id: string;
        role: UserRole;
        clientId?: string;
        merchantId?: string;
        bankId?: string;
      };
    }
  }
}

export {};
