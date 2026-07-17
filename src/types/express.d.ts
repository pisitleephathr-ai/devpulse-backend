declare global {
  namespace Express {
    interface Request {
      /** Populated by the authenticate middleware. `role` is the role CODE;
       *  `permissions` are the role's capability grants (may be empty). */
      user?: { id: string; role: string; permissions?: string[] };
    }
  }
}

export {};
