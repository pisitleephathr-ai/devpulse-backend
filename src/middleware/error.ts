import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

/** Application error with an explicit HTTP status code. */
export class AppError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Wrap async route handlers so rejected promises reach the error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "ไม่พบเส้นทางที่ร้องขอ (Not Found)" });
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "ข้อมูลไม่ถูกต้อง (Validation failed)",
      details: err.flatten().fieldErrors,
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Malformed JSON body (from express.json / body-parser).
  if (
    err instanceof SyntaxError &&
    "type" in err &&
    (err as { type?: string }).type === "entity.parse.failed"
  ) {
    return res.status(400).json({ error: "รูปแบบ JSON ไม่ถูกต้อง (Invalid JSON body)" });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ");
      return res
        .status(409)
        .json({ error: `ข้อมูลซ้ำ (Duplicate): ${target ?? "unique field"}` });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "ไม่พบข้อมูล (Record not found)" });
    }
  }

  console.error(err);
  return res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ (Internal Server Error)" });
}
