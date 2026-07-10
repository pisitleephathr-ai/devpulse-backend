declare global {
  namespace Express {
    interface Request {
      /** Populated by the authenticate middleware. `role` is the role CODE. */
      user?: { id: string; role: string };
    }
  }
}

export {};
