import { HttpError } from "../errors.js";

export function encodeMailbox(path: string): string {
  return Buffer.from(path, "utf8").toString("base64url");
}

export function decodeMailbox(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) {
    throw new HttpError(400, "Unknown folder.", "validation");
  }
  const mailboxPath = Buffer.from(id, "base64url").toString("utf8");
  if (!mailboxPath || mailboxPath.length > 400 || /[\u0000\r\n]/.test(mailboxPath)) {
    throw new HttpError(400, "Unknown folder.", "validation");
  }
  return mailboxPath;
}

const FOLDER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,79}$/u;

export function assertFolderName(name: string): string {
  const trimmed = name.trim();
  if (!FOLDER_NAME.test(trimmed) || /[\\/]/.test(trimmed)) {
    throw new HttpError(
      400,
      "Folder names can use letters, numbers, spaces, and . ' _ -",
      "validation",
    );
  }
  return trimmed;
}

export function assertPartId(partId: string): string {
  if (!/^[1-9]\d{0,3}(\.[1-9]\d{0,3})*$/.test(partId)) {
    throw new HttpError(400, "Unknown attachment.", "validation");
  }
  return partId;
}
