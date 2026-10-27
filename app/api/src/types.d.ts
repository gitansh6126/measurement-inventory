import type { Role } from "@prisma/client";

export interface AuthContext {
  userId: string;
  companyId: string;
  role: Role;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}
