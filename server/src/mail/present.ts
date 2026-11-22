import type {
  Address,
  AttachmentInfo,
  MessageSummary,
  PresentedMessage,
  RawAttachment,
  RawMessage,
  ReplyMode,
  ReplyTemplate,
} from "./types.js";
import { escapeHtml, gateRemoteImages, sanitizeEmailHtml } from "./sanitize.js";

const INLINE_LIMIT = 1_500_000;

export function toSummary(message: RawMessage): MessageSummary {
  return {
    uid: message.uid,
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    seen: message.seen,
    flagged: message.flagged,
    answered: message.answered,
    draft: message.draft,
    hasAttachments: message.hasAttachments,
    preview: message.preview,
    size: message.size,
  };
}

export function presentMessage(raw: RawMessage, options: { remoteImages: boolean }): PresentedMessage {
  const source = raw.html || (raw.text ? `<pre>${escapeHtml(raw.text)}</pre>` : "<p></p>");
  const sanitized = sanitizeEmailHtml(source);
  const embedded = embedContent(sanitized, raw.attachments);
  const gated = gateRemoteImages(embedded.html, options.remoteImages);
  return {
    uid: raw.uid,
    subject: raw.subject,
    from: raw.from,
    to: raw.to,
    cc: raw.cc,
    bcc: raw.bcc,
    replyTo: raw.replyTo,
    date: raw.date,
    seen: raw.seen,
    flagged: raw.flagged,
    answered: raw.answered,
    draft: raw.draft,
    hasAttachments: raw.attachments.some((attachment) => !attachment.inline),
    preview: raw.preview,
    size: raw.size,
    messageId: raw.messageId,
    references: raw.references,
    html: gated.html,
    text: raw.text || "",
    attachments: embedded.attachments,
    remoteImagesBlocked: gated.blocked,
  };
}

function embedContent(html: string, attachments: RawAttachment[]): { html: string; attachments: AttachmentInfo[] } {
  let output = html;
  const presented: AttachmentInfo[] = attachments.map((attachment) => {
    const cid = attachment.contentId?.replace(/[<>]/g, "") || "";
    if (cid && attachment.content && attachment.mime.startsWith("image/")) {
      if (attachment.content.length <= INLINE_LIMIT) {
        const dataUrl = `data:${attachment.mime};base64,${attachment.content.toString("base64")}`;
        output = output.replaceAll(`cid:${cid}`, dataUrl);
      } else {
        const pattern = new RegExp(`<img\\b[^>]*src=(['"])cid:${escapeRegExp(cid)}\\1[^>]*>`, "gi");
        output = output.replace(pattern, `<p>[Image: ${escapeHtml(attachment.filename)}]</p>`);
      }
    }
    return {
      partId: attachment.partId,
      filename: attachment.filename,
      mime: attachment.mime,
      size: attachment.size,
      contentId: attachment.contentId,
      inline: attachment.inline,
    };
  });
  return { html: output, attachments: presented };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildReplyTemplate(
  message: PresentedMessage,
  mode: ReplyMode,
  selfAddress: string,
  signatureHtml: string,
  mailboxId: string,
): ReplyTemplate {
  const signature = signatureHtml.trim() ? sanitizeEmailHtml(signatureHtml) : "";
  const when = message.date ? new Date(message.date).toUTCString() : "";
  const who = formatPeople(message.from);
  const intro =
    mode === "forward"
      ? `<p>---------- Forwarded message ----------</p><p>From: ${escapeHtml(who)}<br>Date: ${escapeHtml(when)}<br>Subject: ${escapeHtml(message.subject || "(no subject)")}</p>`
      : `<p>On ${escapeHtml(when)}, ${escapeHtml(who)} wrote:</p>`;
  const quote = `<blockquote>${intro}${message.html}</blockquote>`;
  const signatureBlock = signature ? `<p></p>${signature}` : "";
  const recipients = recipientsFor(message, mode, selfAddress);
  return {
    mode,
    to: recipients.to,
    cc: recipients.cc,
    subject: subjectFor(message.subject, mode),
    html: `<p></p>${signatureBlock}${quote}`,
    forwardParts: mode === "forward" ? message.attachments.filter((attachment) => !attachment.inline) : [],
    source: {
      mailboxId,
      uid: message.uid,
      messageId: message.messageId,
      references: message.references,
    },
  };
}

export function newMessageHtml(signatureHtml: string): string {
  const signature = signatureHtml.trim() ? sanitizeEmailHtml(signatureHtml) : "";
  return signature ? `<p></p><p></p>${signature}` : "<p></p>";
}

function recipientsFor(message: PresentedMessage, mode: ReplyMode, selfAddress: string): { to: Address[]; cc: Address[] } {
  if (mode === "forward") return { to: [], cc: [] };
  const self = selfAddress.toLowerCase();
  const replyTo = message.replyTo.length ? message.replyTo : message.from;
  if (mode === "reply") {
    let to = dedupe(replyTo, "");
    if (to.length === 0 || to.every((item) => item.address.toLowerCase() === self)) {
      to = dedupe(message.to, self);
    } else {
      to = dedupe(to, self);
    }
    if (to.length === 0) to = replyTo.slice(0, 1);
    return { to, cc: [] };
  }
  const to = dedupe(replyTo, self);
  const cc = dedupe([...message.to, ...message.cc], self).filter(
    (item) => !to.some((entry) => entry.address.toLowerCase() === item.address.toLowerCase()),
  );
  return { to, cc };
}

function dedupe(addresses: Address[], exclude: string): Address[] {
  const seen = new Set<string>();
  const result: Address[] = [];
  for (const address of addresses) {
    const key = address.address.toLowerCase();
    if (!key || (exclude && key === exclude.toLowerCase()) || seen.has(key)) continue;
    seen.add(key);
    result.push({ name: address.name, address: address.address });
  }
  return result;
}

function subjectFor(subject: string, mode: ReplyMode): string {
  const clean = subject.trim() || "(no subject)";
  if (mode === "forward") {
    return /^(fwd|fw)\s*:/i.test(clean) ? clean : `Fwd: ${clean}`;
  }
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

function formatPeople(addresses: Address[]): string {
  if (!addresses.length) return "someone";
  return addresses
    .map((address) => (address.name ? `${address.name} <${address.address}>` : address.address))
    .join(", ");
}
