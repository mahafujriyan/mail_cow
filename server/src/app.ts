import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { safeEqual } from "./crypto.js";
import type { AppDeps } from "./deps.js";
import { HttpError } from "./errors.js";
import { clientKey, readCookies } from "./http.js";
import { logger } from "./logger.js";
import { mountRoutes } from "./routes.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "./session.js";

export function createApp(deps: AppDeps) {
  const app = express();
  if (deps.config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.get("origin");
    if (origin && origin === deps.config.webOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && origin && origin !== deps.config.webOrigin) {
      res.status(403).json({ error: { code: "csrf_failed", message: "The form expired. Refresh and try again." } });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    if (req.path === "/api/health") {
      next();
      return;
    }
    const key = clientKey(req);
    if (deps.apiLimiter.tooMany(key)) {
      res.status(429).json({ error: { code: "rate_limited", message: "Too many requests. Wait a moment." } });
      return;
    }
    deps.apiLimiter.hit(key);
    next();
  });
  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    const cookies = readCookies(req.get("cookie"));
    const header = req.get("x-csrf-token") || "";
    if (!safeEqual(header, cookies[CSRF_COOKIE] || "")) {
      res.status(403).json({ error: { code: "csrf_failed", message: "The form expired. Refresh and try again." } });
      return;
    }
    next();
  });
  app.use((req, _res, next) => {
    const cookies = readCookies(req.get("cookie"));
    req.sessionRow = deps.sessions.read(cookies[SESSION_COOKIE]);
    next();
  });
  mountRoutes(app, deps);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Unknown API route." } });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const field = issue?.path.join(".") || "request";
      const message = issue?.message || "Check the form and try again.";
      res.status(400).json({ error: { code: "validation", message: `${field}: ${message}` } });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const named = error as { name?: string; code?: string };
    if (named.name === "MulterError" && named.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: { code: "payload_too_large", message: "That file is larger than 25 MB." } });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: { code: "validation", message: "The request could not be read." } });
      return;
    }
    logger.error("unhandled request error", { name: error instanceof Error ? error.name : "Error" });
    res.status(500).json({ error: { code: "server_error", message: "Something went wrong." } });
  });
  return app;
}
