import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "./env";

export type JwtPayload = {
  sub: string; // user id
  role: string; // role code, e.g. "ADMIN", "DESIGNER"
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
