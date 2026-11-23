import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  webOrigin: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  sessionSecret: string;
  dataDir: string;
  mailMode: "imap" | "fake";
  mailHost: string;
  imapPort: number;
  smtpPort: number;
  mailTlsCa?: Buffer;
  mailTlsCaFile: string | null;
  maxUploadBytes: number;
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV || "development") as AppConfig["nodeEnv"];
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  const mailMode = env.MAIL_MODE === "fake" ? "fake" : "imap";
  if (mailMode === "fake" && nodeEnv === "production") {
    throw new Error("MAIL_MODE=fake cannot run in production");
  }
  const sessionSecret = required(env, "SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  const dataDir = path.resolve(env.DATA_DIR || "./data");
  let mailTlsCa: Buffer | undefined;
  let mailTlsCaFile: string | null = null;
  if (env.MAIL_TLS_CA_FILE) {
    mailTlsCaFile = path.resolve(env.MAIL_TLS_CA_FILE);
    if (!fs.existsSync(mailTlsCaFile)) {
      throw new Error(`MAIL_TLS_CA_FILE does not exist: ${mailTlsCaFile}`);
    }
    mailTlsCa = fs.readFileSync(mailTlsCaFile);
  }
  return {
    nodeEnv,
    port: Number(env.API_PORT || 4100),
    webOrigin: env.WEB_ORIGIN || "http://127.0.0.1:3100",
    cookieSecure: env.COOKIE_SECURE === "true",
    trustProxy: env.TRUST_PROXY === "1",
    sessionSecret,
    dataDir,
    mailMode,
    mailHost: env.MAIL_HOST || "mail.securityblackrock.com",
    imapPort: Number(env.IMAP_PORT || 993),
    smtpPort: Number(env.SMTP_PORT || 587),
    mailTlsCa,
    mailTlsCaFile,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  };
}

export function loadEnvFile(file: string, env: NodeJS.ProcessEnv = process.env) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}

function packageName(dir: string): string | null {
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

// Already-set environment variables win. server/.env is next, then the repo .env
// fills only keys that are still unset. Paths come from this file so cwd can be
// the repo or server/, including `npm --prefix server` and `node dist/index.js`.
export function loadRuntimeEnv(options?: { moduleDir?: string; cwd?: string; env?: NodeJS.ProcessEnv }) {
  const env = options?.env ?? process.env;
  const moduleDir = options?.moduleDir ?? path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.resolve(moduleDir, "..");
  const repoDir = path.resolve(serverDir, "..");
  const cwd = path.resolve(options?.cwd ?? process.cwd());
  const cwdIsServer = packageName(cwd) === "securityblackrock-webmail-api";
  const cwdIsRepo = fs.existsSync(path.join(cwd, "server", "package.json"));
  const files = [
    path.join(serverDir, ".env"),
    path.join(cwd, "server", ".env"),
    cwdIsServer ? path.join(cwd, ".env") : "",
    path.join(repoDir, ".env"),
    cwdIsRepo ? path.join(cwd, ".env") : "",
    cwdIsServer ? path.join(cwd, "..", ".env") : "",
  ];
  const seen = new Set<string>();
  for (const file of files) {
    if (!file) continue;
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    loadEnvFile(resolved, env);
  }
}

export function tlsOptions(config: AppConfig): {
  minVersion: "TLSv1.2";
  servername: string;
  ca?: Buffer;
} {
  return {
    minVersion: "TLSv1.2",
    servername: config.mailHost,
    ...(config.mailTlsCa ? { ca: config.mailTlsCa } : {}),
  };
}
