import path from "node:path";
import { HttpError } from "../errors.js";

const ALLOWED = new Map<string, { mime: string; kind: "image" | "pdf" | "zip" | "ole" | "rtf" | "text" | "ics" }>([
  [".png", { mime: "image/png", kind: "image" }],
  [".jpg", { mime: "image/jpeg", kind: "image" }],
  [".jpeg", { mime: "image/jpeg", kind: "image" }],
  [".gif", { mime: "image/gif", kind: "image" }],
  [".webp", { mime: "image/webp", kind: "image" }],
  [".pdf", { mime: "application/pdf", kind: "pdf" }],
  [".txt", { mime: "text/plain", kind: "text" }],
  [".csv", { mime: "text/csv", kind: "text" }],
  [".rtf", { mime: "application/rtf", kind: "rtf" }],
  [".doc", { mime: "application/msword", kind: "ole" }],
  [".xls", { mime: "application/vnd.ms-excel", kind: "ole" }],
  [".ppt", { mime: "application/vnd.ms-powerpoint", kind: "ole" }],
  [".docx", { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "zip" }],
  [".xlsx", { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "zip" }],
  [".pptx", { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "zip" }],
  [".odt", { mime: "application/vnd.oasis.opendocument.text", kind: "zip" }],
  [".ods", { mime: "application/vnd.oasis.opendocument.spreadsheet", kind: "zip" }],
  [".odp", { mime: "application/vnd.oasis.opendocument.presentation", kind: "zip" }],
  [".zip", { mime: "application/zip", kind: "zip" }],
  [".ics", { mime: "text/calendar", kind: "ics" }],
]);

export function sanitizeFilename(original: string): string {
  const base = original.replace(/\\/g, "/").split("/").pop() || "file";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 180);
}

export function extensionOf(filename: string): string {
  const ext = path.extname(sanitizeFilename(filename)).toLowerCase();
  return ext;
}

export function canonicalMime(filename: string): string {
  const allowed = ALLOWED.get(extensionOf(filename));
  if (!allowed) {
    throw new HttpError(400, "This file type is not allowed.", "unsupported_file");
  }
  return allowed.mime;
}

export function assertFileContent(filename: string, sample: Buffer) {
  if (sample.length === 0) {
    throw new HttpError(400, "The file is empty.", "unsupported_file");
  }
  if (sample.length >= 2 && sample[0] === 0x4d && sample[1] === 0x5a) {
    throw new HttpError(400, "This file type is not allowed.", "unsupported_file");
  }
  if (sample.length >= 4 && sample[0] === 0x7f && sample[1] === 0x45 && sample[2] === 0x4c && sample[3] === 0x46) {
    throw new HttpError(400, "This file type is not allowed.", "unsupported_file");
  }
  if (!sniffMatchesExtension(filename, sample)) {
    throw new HttpError(400, "The file contents do not match its extension.", "unsupported_file");
  }
}

function matchKind(kind: "image" | "pdf" | "zip" | "ole" | "rtf" | "text" | "ics", sample: Buffer): boolean {
  if (kind === "image") return isPng(sample) || isJpeg(sample) || isGif(sample) || isWebp(sample);
  if (kind === "pdf") return startsWith(sample, [0x25, 0x50, 0x44, 0x46]);
  if (kind === "zip") return isZip(sample);
  if (kind === "ole") return startsWith(sample, [0xd0, 0xcf, 0x11, 0xe0]);
  if (kind === "rtf") return sample.subarray(0, 5).toString("utf8").toLowerCase() === "{\\rtf";
  if (kind === "text" || kind === "ics") return !sample.subarray(0, 1024).includes(0);
  return false;
}

export function sniffMatchesExtension(filename: string, sample: Buffer): boolean {
  const allowed = ALLOWED.get(extensionOf(filename));
  if (!allowed) return false;
  if (allowed.kind === "image") {
    const ext = extensionOf(filename);
    if (ext === ".png") return isPng(sample);
    if (ext === ".jpg" || ext === ".jpeg") return isJpeg(sample);
    if (ext === ".gif") return isGif(sample);
    if (ext === ".webp") return isWebp(sample);
  }
  return matchKind(allowed.kind, sample);
}

function startsWith(sample: Buffer, bytes: number[]): boolean {
  if (sample.length < bytes.length) return false;
  return bytes.every((byte, index) => sample[index] === byte);
}

function isPng(sample: Buffer) {
  return startsWith(sample, [0x89, 0x50, 0x4e, 0x47]);
}

function isJpeg(sample: Buffer) {
  return startsWith(sample, [0xff, 0xd8, 0xff]);
}

function isGif(sample: Buffer) {
  return startsWith(sample, [0x47, 0x49, 0x46, 0x38]);
}

function isWebp(sample: Buffer) {
  return startsWith(sample, [0x52, 0x49, 0x46, 0x46]) && sample.subarray(8, 12).toString("ascii") === "WEBP";
}

function isZip(sample: Buffer) {
  return (
    startsWith(sample, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(sample, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(sample, [0x50, 0x4b, 0x07, 0x08])
  );
}

const DOWNLOAD_SAFE = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/calendar",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/zip",
  "application/rtf",
]);

export function downloadMime(mime: string): string {
  const base = mime.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  if (DOWNLOAD_SAFE.has(base) || base.startsWith("application/vnd.")) return base;
  return "application/octet-stream";
}

export function contentDisposition(filename: string): string {
  const safe = sanitizeFilename(filename).replace(/["\\]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
