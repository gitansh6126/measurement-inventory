import type { Role } from "@prisma/client";

export interface AuthContext {
  userId: string;
  companyId: string;
  role: Role;
  sessionId: string;
  isCustomerMode?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}
