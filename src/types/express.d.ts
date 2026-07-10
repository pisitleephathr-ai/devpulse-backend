import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      /** Populated by the authenticate middleware. */
      user?: { id: string; role: Role };
    }
  }
}

export {};
