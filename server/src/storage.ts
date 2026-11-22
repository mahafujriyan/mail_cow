import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { AppDatabase, UploadRecord } from "./db.js";
import { HttpError } from "./errors.js";

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uploadDirectory(config: AppConfig): string {
  const dir = path.join(config.dataDir, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeUploadPath(config: AppConfig, storedName: string): string | null {
  if (!STORED_NAME.test(storedName)) return null;
  const root = path.resolve(uploadDirectory(config));
  const full = path.resolve(root, storedName);
  if (path.dirname(full) !== root) return null;
  return full;
}

export function readOwnedUpload(db: AppDatabase, config: AppConfig, email: string, id: string): { record: UploadRecord; content: Buffer } {
  if (!STORED_NAME.test(id)) throw new HttpError(400, "An attachment expired. Add it again.", "not_found");
  const record = db.getUpload(email, id);
  if (!record) throw new HttpError(400, "An attachment expired. Add it again.", "not_found");
  const full = safeUploadPath(config, record.storedName);
  if (!full || !fs.existsSync(full)) throw new HttpError(400, "An attachment expired. Add it again.", "not_found");
  return { record, content: fs.readFileSync(full) };
}

export function removeUploadFile(config: AppConfig, storedName: string) {
  const full = safeUploadPath(config, storedName);
  if (!full) return;
  fs.rmSync(full, { force: true });
}

export function purgeExpiredUploads(db: AppDatabase, config: AppConfig) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const upload of db.expiredUploads(cutoff)) {
    removeUploadFile(config, upload.storedName);
    db.deleteUploadById(upload.id);
  }
}
