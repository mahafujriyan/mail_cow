import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { AppDatabase } from "../src/db.js";
import type { AppDeps } from "../src/deps.js";
import { HttpError } from "../src/errors.js";
import { createFakeMailbox, DEMO_EMAIL, DEMO_PASSWORD } from "../src/mail/fake.js";
import { MailboxPool } from "../src/mail/pool.js";
import { RateLimiter } from "../src/rate-limit.js";
import { SessionStore } from "../src/session.js";

export function demoConfig(dataDir: string): AppConfig {
  return {
    nodeEnv: "test",
    port: 0,
    webOrigin: "http://127.0.0.1",
    cookieSecure: false,
    trustProxy: false,
    sessionSecret: "test-session-secret-should-be-long-enough",
    dataDir,
    mailMode: "fake",
    mailHost: "mail.securityblackrock.com",
    imapPort: 993,
    smtpPort: 587,
    mailTlsCaFile: null,
    maxUploadBytes: 25 * 1024 * 1024,
  };
}

export async function withApi(fn: (base: string, dbPath: string) => Promise<void>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbr-webmail-"));
  const db = new AppDatabase(path.join(dataDir, "webmail.db"));
  const config = demoConfig(dataDir);
  let delivered: Buffer[] = [];
  const deps: AppDeps = {
    config,
    db,
    sessions: new SessionStore(db, config.sessionSecret),
    pool: new MailboxPool(() => createFakeMailbox()),
    authenticate: async (email, password) => {
      if (email.toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
        throw new HttpError(401, "Invalid email or password.", "invalid_credentials");
      }
    },
    deliver: async (_auth, raw) => {
      delivered.push(raw);
    },
    loginLimiter: new RateLimiter(4, 15 * 60 * 1000),
    apiLimiter: new RateLimiter(1000, 60 * 1000),
    uploadLimiter: new RateLimiter(30, 15 * 60 * 1000),
  };
  const app = createApp(deps);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${address.port}`, path.join(dataDir, "webmail.db"));
    return delivered;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

export async function csrf(base: string) {
  const response = await fetch(`${base}/api/auth/csrf`);
  const body = (await response.json()) as { csrfToken: string };
  const cookie = response.headers.getSetCookie().find((item) => item.startsWith("sbr_csrf=")) || "";
  return { token: body.csrfToken, cookie: cookie.split(";")[0] };
}

export async function login(base: string, password = DEMO_PASSWORD) {
  const gate = await csrf(base);
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": gate.token,
      cookie: gate.cookie,
    },
    body: JSON.stringify({ email: DEMO_EMAIL, password }),
  });
  const body = (await response.json()) as { csrfToken?: string; email?: string; error?: { message: string } };
  const cookies = response.headers.getSetCookie().map((item) => item.split(";")[0]);
  return { status: response.status, body, cookie: cookies.join("; "), token: body.csrfToken || gate.token };
}

export { DEMO_EMAIL, DEMO_PASSWORD };
