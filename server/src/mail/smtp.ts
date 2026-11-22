import { createRequire } from "node:module";
import nodemailer from "nodemailer";
import type { AppConfig } from "../config.js";
import { tlsOptions } from "../config.js";
import { HttpError } from "../errors.js";
import { logger } from "../logger.js";
import type { OutboundMessage } from "./outgoing.js";

const require = createRequire(import.meta.url);
const MailComposer = require("nodemailer/lib/mail-composer") as new (mail: Record<string, unknown>) => {
  compile(): { build(): Promise<Buffer> };
};

export async function compileMessage(message: OutboundMessage): Promise<Buffer> {
  const composer = new MailComposer({
    from: message.from.name ? { name: message.from.name, address: message.from.address } : message.from.address,
    to: message.to.map(formatAddress),
    cc: message.cc.map(formatAddress),
    subject: message.subject,
    html: message.html,
    text: message.text || "",
    attachments: message.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.mime,
      cid: attachment.cid,
      contentDisposition: attachment.cid ? "inline" : "attachment",
    })),
    inReplyTo: message.inReplyTo,
    references: message.references,
    headers: { "X-Mailer": "Blackrock Mail" },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return composer.compile().build();
}

export async function deliverMessage(
  config: AppConfig,
  auth: { email: string; password: string },
  raw: Buffer,
  recipients: string[],
) {
  const transport = nodemailer.createTransport({
    host: config.mailHost,
    port: config.smtpPort,
    secure: false,
    requireTLS: true,
    auth: { user: auth.email, pass: auth.password },
    tls: tlsOptions(config),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 120_000,
    logger: false,
    debug: false,
  });
  try {
    await transport.sendMail({
      envelope: { from: auth.email, to: recipients },
      raw,
    });
  } catch (error) {
    throw classifySmtpError(error);
  } finally {
    transport.close();
  }
}

function formatAddress(address: { name: string; address: string }) {
  const name = address.name.replace(/[\r\n"]/g, "").trim();
  return name ? { name, address: address.address } : address.address;
}

export function classifySmtpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const record = error as { code?: string; responseCode?: number };
  if (record.code === "EAUTH" || record.responseCode === 535) {
    return new HttpError(401, "Invalid email or password.", "invalid_credentials");
  }
  if (/certificate|UNABLE_TO_VERIFY|self-signed/i.test(record.code || "")) {
    return new HttpError(503, "The secure connection to the mail server was rejected.", "tls_failed");
  }
  logger.warn("smtp send failed", { code: record.code || "", responseCode: record.responseCode || 0 });
  return new HttpError(502, "The message could not be sent.", "mail_unavailable");
}
