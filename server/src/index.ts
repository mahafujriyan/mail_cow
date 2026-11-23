import path from "node:path";
import { createApp } from "./app.js";
import { loadConfig, loadRuntimeEnv } from "./config.js";
import { AppDatabase } from "./db.js";
import type { AppDeps } from "./deps.js";
import { HttpError } from "./errors.js";
import { logger } from "./logger.js";
import { createFakeMailbox, DEMO_EMAIL, DEMO_PASSWORD } from "./mail/fake.js";
import { classifyMailError, ImapMailbox, verifyMailboxLogin } from "./mail/imap.js";
import { MailboxPool } from "./mail/pool.js";
import { deliverMessage } from "./mail/smtp.js";
import { RateLimiter } from "./rate-limit.js";
import { SessionStore } from "./session.js";
import { purgeExpiredUploads } from "./storage.js";

loadRuntimeEnv();

const config = loadConfig();
const db = new AppDatabase(path.join(config.dataDir, "webmail.db"));

const deps: AppDeps = {
  config,
  db,
  sessions: new SessionStore(db, config.sessionSecret),
  pool: new MailboxPool((auth) => (config.mailMode === "fake" ? createFakeMailbox() : new ImapMailbox(config, auth))),
  authenticate: async (email, password) => {
    if (config.mailMode === "fake") {
      if (email.toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
        throw new HttpError(401, "Invalid email or password.", "invalid_credentials");
      }
      return;
    }
    try {
      await verifyMailboxLogin(config, email, password);
    } catch (error) {
      throw classifyMailError(error);
    }
  },
  deliver: (auth, raw, recipients) => {
    if (config.mailMode === "fake") return Promise.resolve();
    return deliverMessage(config, auth, raw, recipients);
  },
  loginLimiter: new RateLimiter(8, 15 * 60 * 1000),
  apiLimiter: new RateLimiter(300, 60 * 1000),
  uploadLimiter: new RateLimiter(40, 15 * 60 * 1000),
};

const app = createApp(deps);
const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info("api listening", { port: config.port, mailMode: config.mailMode });
});
server.requestTimeout = 120_000;

const sweep = setInterval(() => {
  void deps.pool.sweep();
  db.deleteExpiredSessions(Date.now());
  purgeExpiredUploads(db, config);
}, 60_000);
sweep.unref();

async function shutdown() {
  clearInterval(sweep);
  await deps.pool.closeAll();
  server.close();
  db.close();
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
