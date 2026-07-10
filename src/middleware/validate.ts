import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

/**
 * Validate request parts with Zod. Parsed (and coerced) values replace the
 * originals so controllers read clean, typed data. ZodErrors are forwarded
 * to the central error handler.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        // req.query is a getter in some setups; mutate in place to stay safe.
        Object.assign(req.query, schemas.query.parse(req.query));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export { z } from "zod";
