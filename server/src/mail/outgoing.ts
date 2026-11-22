import type { Address } from "./types.js";
import { htmlToText, sanitizeEmailHtml } from "./sanitize.js";

export type OutboundAttachment = {
  filename: string;
  content: Buffer;
  mime: string;
  cid?: string;
};

export type OutboundMessage = {
  from: { name: string; address: string };
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  text: string;
  attachments: OutboundAttachment[];
  inReplyTo?: string;
  references?: string[];
};

const UPLOAD_ID = /data-upload-id=(['"])([0-9a-f-]{36})\1/gi;

export function extractUploadIds(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(UPLOAD_ID)) {
    if (match[2]) ids.add(match[2]);
  }
  return [...ids];
}

export function replaceInlineUploads(html: string): { html: string; cids: Map<string, string> } {
  const cids = new Map<string, string>();
  const next = html.replace(/<img\b[^>]*data-upload-id=(['"])([0-9a-f-]{36})\1[^>]*>/gi, (_tag, _quote, id: string) => {
    const cid = `cid-${id}@securityblackrock.com`;
    cids.set(id, cid);
    return `<img src="cid:${cid}" alt="">`;
  });
  return { html: next, cids };
}

export function prepareOutgoingHtml(html: string): { html: string; text: string; inlineIds: string[] } {
  const inlineIds = extractUploadIds(html);
  const replaced = replaceInlineUploads(html);
  const safe = sanitizeEmailHtml(replaced.html);
  const text = htmlToText(safe);
  return { html: safe, text, inlineIds };
}

export function cleanHeaderText(value: string, max: number): string {
  return value.replace(/[\r\n\u0000]/g, " ").trim().slice(0, max);
}

export function normalizeMessageId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/[\r\n<>]/g, "");
  if (!/^[^\s]{1,200}$/.test(trimmed)) return undefined;
  return `<${trimmed}>`;
}

export function referencesHeader(references: string[], messageId?: string): string[] | undefined {
  const items = [...references, ...(messageId ? [messageId] : [])]
    .map((item) => item.replace(/[\r\n]/g, "").trim())
    .filter((item) => /^<[^<>\s]+>$/.test(item) || /^[^<>\s]+$/.test(item))
    .map((item) => (item.startsWith("<") ? item : `<${item}>`))
    .slice(0, 40);
  return items.length ? items : undefined;
}

export function insertBccHeader(raw: Buffer, bcc: string[]): Buffer {
  if (!bcc.length) return raw;
  const marker = Buffer.from("\r\n\r\n");
  const index = raw.subarray(0, 100_000).indexOf(marker);
  if (index < 0) return raw;
  const line = Buffer.from(`\r\nBcc: ${bcc.join(", ")}\r\n`);
  return Buffer.concat([raw.subarray(0, index), line, raw.subarray(index + 2)]);
}
