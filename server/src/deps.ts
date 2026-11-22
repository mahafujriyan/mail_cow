import type { Request, Response } from "express";
import type { AppConfig } from "./config.js";
import type { AppDatabase, SessionRowRecord } from "./db.js";
import { HttpError } from "./errors.js";
import { classifyMailError } from "./mail/imap.js";
import type { MailboxClient } from "./mail/types.js";
import type { MailboxPool } from "./mail/pool.js";
import type { RateLimiter } from "./rate-limit.js";
import { clearSessionCookie, type SessionStore } from "./session.js";

export type AppDeps = {
  config: AppConfig;
  db: AppDatabase;
  sessions: SessionStore;
  pool: MailboxPool;
  authenticate: (email: string, password: string) => Promise<void>;
  deliver: (auth: { email: string; password: string }, raw: Buffer, recipients: string[]) => Promise<void>;
  loginLimiter: RateLimiter;
  apiLimiter: RateLimiter;
  uploadLimiter: RateLimiter;
};

export function requireSession(req: Request): SessionRowRecord {
  if (!req.sessionRow) throw new HttpError(401, "Sign in again.", "unauthorized");
  return req.sessionRow;
}

export async function withMailbox<T>(
  req: Request,
  res: Response,
  deps: AppDeps,
  fn: (client: MailboxClient, session: SessionRowRecord, password: string) => Promise<T>,
): Promise<T> {
  const session = requireSession(req);
  let password = "";
  try {
    password = deps.sessions.password(session);
  } catch {
    deps.sessions.destroy(session.id);
    clearSessionCookie(res, deps.config);
    throw new HttpError(401, "Sign in again.", "unauthorized");
  }
  const client = await deps.pool.acquire(session.id, { email: session.email, password });
  try {
    return await fn(client, session, password);
  } catch (error) {
    const httpError = classifyMailError(error);
    if (httpError.status === 401) {
      await deps.pool.drop(session.id);
      deps.sessions.destroy(session.id);
      clearSessionCookie(res, deps.config);
    }
    throw httpError;
  }
}
