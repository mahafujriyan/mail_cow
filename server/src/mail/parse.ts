import type { ParsedMail } from "mailparser";
import { HttpError } from "../errors.js";
import type { Address, RawAttachment, RawMessage } from "./types.js";

type AddressObject = { name?: string; address?: string };

export function mapAddresses(value: unknown): Address[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const addresses: Address[] = [];
  for (const item of list) {
    const group = item as { value?: AddressObject[] } | AddressObject;
    const entries = "value" in group && Array.isArray(group.value) ? group.value : [group as AddressObject];
    for (const entry of entries) {
      const address = (entry.address || "").trim();
      if (!address || /[\r\n]/.test(address)) continue;
      addresses.push({
        name: (entry.name || "").replace(/[\r\n]/g, "").trim(),
        address,
      });
    }
  }
  return addresses;
}

export function previewText(value: string | undefined | null): string {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function parsedToRaw(
  parsed: ParsedMail,
  meta: {
    uid: number;
    flags?: Iterable<string>;
    date?: Date | null;
    size?: number;
  },
): RawMessage {
  const flags = new Set(Array.from(meta.flags || []).map((flag) => flag.toLowerCase()));
  const attachments: RawAttachment[] = (parsed.attachments || []).map((attachment, index) => {
    const partId = attachment.partId && /^[1-9]\d{0,3}(\.[1-9]\d{0,3})*$/.test(attachment.partId)
      ? attachment.partId
      : String(index + 1);
    const mime = (attachment.contentType || "application/octet-stream").split(";")[0]?.trim().toLowerCase()
      || "application/octet-stream";
    const inline = attachment.contentDisposition === "inline" || Boolean(attachment.cid);
    return {
      partId,
      filename: attachment.filename || (inline ? "image" : "attachment"),
      mime,
      size: attachment.size || attachment.content?.length || 0,
      contentId: attachment.cid ? attachment.cid.replace(/[<>]/g, "") : null,
      inline,
      content: attachment.content,
    };
  });
  const html = typeof parsed.html === "string" ? parsed.html : null;
  const text = parsed.text || null;
  const date = meta.date || parsed.date || null;
  return {
    uid: meta.uid,
    subject: parsed.subject || "",
    from: mapAddresses(parsed.from),
    to: mapAddresses(parsed.to),
    cc: mapAddresses(parsed.cc),
    bcc: mapAddresses(parsed.bcc),
    replyTo: mapAddresses(parsed.replyTo),
    date: date ? new Date(date).toISOString() : null,
    seen: flags.has("\\seen"),
    flagged: flags.has("\\flagged"),
    answered: flags.has("\\answered"),
    draft: flags.has("\\draft"),
    hasAttachments: attachments.some((attachment) => !attachment.inline),
    preview: previewText(text || (html ? html.replace(/<[^>]+>/g, " ") : "")),
    size: meta.size || 0,
    messageId: parsed.messageId || null,
    references: normalizeReferences(parsed.references),
    html,
    text,
    attachments,
  };
}

function normalizeReferences(value: ParsedMail["references"]): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => item.trim()).filter(Boolean).slice(0, 40);
}

export function requireMessage(message: RawMessage | undefined, uid: number): RawMessage {
  if (!message) throw new HttpError(404, "That message is gone.", "not_found");
  if (message.uid !== uid) throw new HttpError(404, "That message is gone.", "not_found");
  return message;
}
