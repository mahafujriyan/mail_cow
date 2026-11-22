import type { Request, Response } from "express";
import { HttpError } from "./errors.js";

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: (error?: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function readCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

export function queryValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export function parseUid(value: string): number {
  if (!/^[1-9]\d{0,11}$/.test(value)) {
    throw new HttpError(400, "Unknown message.", "validation");
  }
  const uid = Number(value);
  if (!Number.isSafeInteger(uid) || uid > 4_294_967_295) {
    throw new HttpError(400, "Unknown message.", "validation");
  }
  return uid;
}

export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}
