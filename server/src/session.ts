import type { Response } from "express";
import type { AppConfig } from "./config.js";
import { decryptString, deriveKey, encryptString, randomToken } from "./crypto.js";
import type { AppDatabase, SessionRowRecord } from "./db.js";

export const SESSION_COOKIE = "sbr_sid";
export const CSRF_COOKIE = "sbr_csrf";
const IDLE_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

export class SessionStore {
  private readonly key: Buffer;

  constructor(
    private readonly db: AppDatabase,
    secret: string,
  ) {
    this.key = deriveKey(secret);
  }

  create(email: string, password: string): string {
    const now = Date.now();
    const id = randomToken(32);
    this.db.createSession({
      id,
      email: email.toLowerCase(),
      passwordEnc: encryptString(password, this.key),
      createdAt: now,
      expiresAt: now + IDLE_MS,
      absoluteExpiresAt: now + ABSOLUTE_MS,
    });
    return id;
  }

  read(id: string | undefined): SessionRowRecord | undefined {
    if (!id || id.length < 20) return undefined;
    const row = this.db.getSession(id);
    if (!row) return undefined;
    const now = Date.now();
    if (row.expires_at <= now || row.absolute_expires_at <= now) {
      this.db.deleteSession(id);
      return undefined;
    }
    const expiresAt = Math.min(now + IDLE_MS, row.absolute_expires_at);
    this.db.touchSession(id, expiresAt, now);
    return { ...row, expires_at: expiresAt, last_seen_at: now };
  }

  password(row: SessionRowRecord): string {
    return decryptString(row.password_enc, this.key);
  }

  destroy(id: string) {
    this.db.deleteSession(id);
  }
}

export function cookieBase(config: AppConfig) {
  return {
    secure: config.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
  };
}

export function setSessionCookie(res: Response, config: AppConfig, sessionId: string) {
  res.cookie(SESSION_COOKIE, sessionId, {
    ...cookieBase(config),
    httpOnly: true,
    maxAge: ABSOLUTE_MS,
  });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(SESSION_COOKIE, { ...cookieBase(config), httpOnly: true });
}

export function setCsrfCookie(res: Response, config: AppConfig): string {
  const token = randomToken(32);
  res.cookie(CSRF_COOKIE, token, {
    ...cookieBase(config),
    httpOnly: false,
    maxAge: ABSOLUTE_MS,
  });
  return token;
}
