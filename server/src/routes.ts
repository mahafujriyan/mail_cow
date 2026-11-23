import crypto from "node:crypto";
import fs from "node:fs";
import type { Express, Request } from "express";
import multer from "multer";
import type { AppDeps } from "./deps.js";
import { requireSession, withMailbox } from "./deps.js";
import { HttpError } from "./errors.js";
import { asyncHandler, clientKey, parseUid, queryValue } from "./http.js";
import { assertFolderName, assertPartId, decodeMailbox, encodeMailbox } from "./mail/ids.js";
import { contentDisposition, downloadMime, sanitizeFilename, assertFileContent, canonicalMime } from "./mail/files.js";
import { buildReplyTemplate, newMessageHtml, presentMessage } from "./mail/present.js";
import {
  cleanHeaderText,
  insertBccHeader,
  normalizeMessageId,
  prepareOutgoingHtml,
  referencesHeader,
  type OutboundMessage,
} from "./mail/outgoing.js";
import { compileMessage } from "./mail/smtp.js";
import type { Address, ListQuery, MailboxInfo } from "./mail/types.js";
import {
  contactSchema,
  deleteSchema,
  draftSchema,
  flagSchema,
  folderSchema,
  loginSchema,
  moveSchema,
  sendSchema,
  settingsSchema,
  type SendInput,
} from "./schemas.js";
import { setCsrfCookie, setSessionCookie, clearSessionCookie } from "./session.js";
import { sanitizeEmailHtml } from "./mail/sanitize.js";
import { readOwnedUpload, removeUploadFile, safeUploadPath, uploadDirectory } from "./storage.js";

const MAX_MESSAGE_BYTES = 35 * 1024 * 1024;
const MAX_UPLOAD_QUOTA = 200 * 1024 * 1024;

export function mountRoutes(app: Express, deps: AppDeps) {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "securityblackrock-webmail" });
  });

  app.get(
    "/api/auth/csrf",
    asyncHandler(async (_req, res) => {
      const csrfToken = setCsrfCookie(res, deps.config);
      res.json({ csrfToken });
    }),
  );

  app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const key = `${clientKey(req)}|${input.email.toLowerCase()}`;
      if (deps.loginLimiter.tooMany(key)) {
        throw new HttpError(429, "Too many sign-in attempts. Wait and try again.", "rate_limited");
      }
      try {
        await deps.authenticate(input.email, input.password);
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) deps.loginLimiter.hit(key);
        throw error;
      }
      deps.loginLimiter.clear(key);
      const sessionId = deps.sessions.create(input.email, input.password);
      setSessionCookie(res, deps.config, sessionId);
      const csrfToken = setCsrfCookie(res, deps.config);
      const email = input.email.toLowerCase();
      res.json({ email, demo: deps.config.mailMode === "fake", csrfToken, settings: deps.db.getSettings(email) });
    }),
  );

  app.post(
    "/api/auth/logout",
    asyncHandler(async (req, res) => {
      if (req.sessionRow) {
        await deps.pool.drop(req.sessionRow.id);
        deps.sessions.destroy(req.sessionRow.id);
      }
      clearSessionCookie(res, deps.config);
      res.status(204).end();
    }),
  );

  app.get(
    "/api/auth/me",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      res.json({
        email: session.email,
        demo: deps.config.mailMode === "fake",
        settings: deps.db.getSettings(session.email),
      });
    }),
  );

  app.get(
    "/api/mailboxes",
    asyncHandler(async (req, res) => {
      const boxes = await withMailbox(req, res, deps, (client) => client.listMailboxes());
      res.json({ mailboxes: boxes });
    }),
  );

  app.post(
    "/api/mailboxes",
    asyncHandler(async (req, res) => {
      const name = assertFolderName(folderSchema.parse(req.body).name);
      await withMailbox(req, res, deps, (client) => client.createMailbox(name));
      res.status(201).json({ id: encodeMailbox(name) });
    }),
  );

  app.patch(
    "/api/mailboxes/:id",
    asyncHandler(async (req, res) => {
      const current = decodeMailbox(param(req, "id"));
      const name = assertFolderName(folderSchema.parse(req.body).name);
      await withMailbox(req, res, deps, async (client) => {
        const boxes = await client.listMailboxes();
        const box = requireBox(boxes, current);
        if (box.role !== "custom") throw new HttpError(400, "That folder cannot be renamed.", "validation");
        await client.renameMailbox(current, name);
      });
      res.json({ id: encodeMailbox(name) });
    }),
  );

  app.delete(
    "/api/mailboxes/:id",
    asyncHandler(async (req, res) => {
      const current = decodeMailbox(param(req, "id"));
      await withMailbox(req, res, deps, async (client) => {
        const boxes = await client.listMailboxes();
        const box = requireBox(boxes, current);
        if (box.role !== "custom") throw new HttpError(400, "That folder cannot be deleted.", "validation");
        await client.deleteMailbox(current);
      });
      res.status(204).end();
    }),
  );

  app.get(
    "/api/mailboxes/:id/messages",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      const query = readListQuery(req);
      const page = await withMailbox(req, res, deps, (client) => client.listMessages(mailboxPath, query));
      res.json(page);
    }),
  );

  app.get(
    "/api/mailboxes/:id/messages/:uid",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      const uid = parseUid(param(req, "uid"));
      const remoteImages = queryValue(req.query.remoteImages) === "1";
      const message = await withMailbox(req, res, deps, async (client) => {
        const raw = await client.getMessage(mailboxPath, uid);
        if (!raw.seen) await client.setFlags(mailboxPath, [uid], { seen: true });
        return presentMessage({ ...raw, seen: true }, { remoteImages });
      });
      res.json(message);
    }),
  );

  app.get(
    "/api/mailboxes/:id/messages/:uid/reply",
    asyncHandler(async (req, res) => {
      const mailboxId = param(req, "id");
      const mailboxPath = decodeMailbox(mailboxId);
      const uid = parseUid(param(req, "uid"));
      const mode = queryValue(req.query.mode);
      if (mode !== "reply" && mode !== "replyAll" && mode !== "forward") {
        throw new HttpError(400, "Choose reply, reply all, or forward.", "validation");
      }
      const template = await withMailbox(req, res, deps, async (client, session) => {
        const raw = await client.getMessage(mailboxPath, uid);
        const presented = presentMessage(raw, { remoteImages: true });
        const settings = deps.db.getSettings(session.email);
        return buildReplyTemplate(presented, mode, session.email, settings.signatureHtml, mailboxId);
      });
      res.json(template);
    }),
  );

  app.get(
    "/api/mailboxes/:id/messages/:uid/attachments/:partId",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      const uid = parseUid(param(req, "uid"));
      const partId = assertPartId(param(req, "partId"));
      const file = await withMailbox(req, res, deps, (client) => client.getAttachment(mailboxPath, uid, partId));
      res.setHeader("Content-Type", downloadMime(file.mime));
      res.setHeader("Content-Disposition", contentDisposition(sanitizeFilename(file.filename)));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.send(file.content);
    }),
  );

  app.post(
    "/api/mailboxes/:id/flags",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      const input = flagSchema.parse(req.body);
      await withMailbox(req, res, deps, (client) =>
        client.setFlags(mailboxPath, input.uids, { seen: input.seen, flagged: input.flagged }),
      );
      res.status(204).end();
    }),
  );

  app.post(
    "/api/mailboxes/:id/read",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      await withMailbox(req, res, deps, async (client) => {
        const uids = await collectUids(client, mailboxPath, "unread");
        if (uids.length) await client.setFlags(mailboxPath, uids.slice(0, 500), { seen: true });
      });
      res.status(204).end();
    }),
  );

  app.post(
    "/api/mailboxes/:id/move",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      const input = moveSchema.parse(req.body);
      const destination = decodeMailbox(input.destinationId);
      await withMailbox(req, res, deps, (client) => client.move(mailboxPath, input.uids, destination));
      res.status(204).end();
    }),
  );

  app.post(
    "/api/mailboxes/:id/delete",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      const input = deleteSchema.parse(req.body);
      await withMailbox(req, res, deps, async (client) => {
        const boxes = await client.listMailboxes();
        const trash = boxes.find((box) => box.role === "trash");
        await client.remove(mailboxPath, input.uids, trash?.path || null);
      });
      res.status(204).end();
    }),
  );

  app.post(
    "/api/mailboxes/:id/empty",
    asyncHandler(async (req, res) => {
      const mailboxPath = decodeMailbox(param(req, "id"));
      await withMailbox(req, res, deps, async (client) => {
        const boxes = await client.listMailboxes();
        const box = requireBox(boxes, mailboxPath);
        if (box.role !== "trash" && box.role !== "junk") {
          throw new HttpError(400, "Only spam and trash can be emptied.", "validation");
        }
        const uids = await collectUids(client, mailboxPath, "all");
        if (uids.length) await client.remove(mailboxPath, uids, null);
      });
      res.status(204).end();
    }),
  );

  app.get(
    "/api/inbox/summary",
    asyncHandler(async (req, res) => {
      const summary = await withMailbox(req, res, deps, (client) => client.inboxSummary());
      res.json(summary);
    }),
  );

  app.post(
    "/api/messages/send",
    asyncHandler(async (req, res) => {
      const input = sendSchema.parse(req.body);
      const result = await withMailbox(req, res, deps, async (client, session, password) => {
        const boxes = await client.listMailboxes();
        const built = await buildOutbound(deps, session.email, client, input, true);
        const raw = await compileMessage(built.message);
        await deps.deliver({ email: session.email, password }, raw, built.recipients);
        let savedToSent = false;
        const sent = boxes.find((box) => box.role === "sent");
        if (sent) {
          try {
            await client.append(sent.path, insertBccHeader(raw, built.message.bcc.map((item) => item.address)), ["\\Seen"]);
            savedToSent = true;
          } catch {
            savedToSent = false;
          }
        }
        if (input.draftUid) {
          const drafts = boxes.find((box) => box.role === "drafts");
          if (drafts) await client.remove(drafts.path, [input.draftUid], null).catch(() => undefined);
        }
        if (input.inReplyTo) {
          await client
            .setFlags(decodeMailbox(input.inReplyTo.mailboxId), [input.inReplyTo.uid], { answered: true })
            .catch(() => undefined);
        }
        discardUploads(deps, session.email, built.uploadIds);
        deps.db.rememberRecipients(session.email, [...built.message.to, ...built.message.cc, ...built.message.bcc]);
        return { sent: true, savedToSent };
      });
      res.json(result);
    }),
  );

  app.post(
    "/api/drafts",
    asyncHandler(async (req, res) => {
      const input = draftSchema.parse(req.body);
      const result = await withMailbox(req, res, deps, async (client, session) => {
        const boxes = await client.listMailboxes();
        const drafts = boxes.find((box) => box.role === "drafts");
        if (!drafts) throw new HttpError(400, "This account has no Drafts folder.", "validation");
        const built = await buildOutbound(deps, session.email, client, input, false);
        const raw = await compileMessage(built.message);
        if (input.draftUid) await client.remove(drafts.path, [input.draftUid], null).catch(() => undefined);
        const uid = await client.append(drafts.path, raw, ["\\Draft", "\\Seen"]);
        return { uid };
      });
      res.json(result);
    }),
  );

  app.get(
    "/api/contacts",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const q = queryValue(req.query.q).slice(0, 120);
      res.json({ contacts: deps.db.listContacts(session.email, q) });
    }),
  );

  app.get(
    "/api/contacts/suggest",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const q = queryValue(req.query.q).slice(0, 120);
      res.json({ suggestions: deps.db.suggestRecipients(session.email, q) });
    }),
  );

  app.post(
    "/api/contacts",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const input = contactSchema.parse(req.body);
      const contact = { id: crypto.randomUUID(), ...input };
      deps.db.createContact(session.email, contact);
      res.status(201).json(contact);
    }),
  );

  app.patch(
    "/api/contacts/:id",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const input = contactSchema.parse(req.body);
      const contact = { id: param(req, "id"), ...input };
      if (!deps.db.updateContact(session.email, contact)) {
        throw new HttpError(404, "That contact is gone.", "not_found");
      }
      res.json(contact);
    }),
  );

  app.delete(
    "/api/contacts/:id",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      if (!deps.db.deleteContact(session.email, param(req, "id"))) {
        throw new HttpError(404, "That contact is gone.", "not_found");
      }
      res.status(204).end();
    }),
  );

  app.get(
    "/api/settings",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      res.json(deps.db.getSettings(session.email));
    }),
  );

  app.put(
    "/api/settings",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const input = settingsSchema.parse(req.body);
      const current = deps.db.getSettings(session.email);
      const settings = {
        displayName: cleanHeaderText(input.displayName, 120),
        signatureHtml: sanitizeEmailHtml(input.signatureHtml),
        language: input.language,
        timeZone: input.timeZone,
        theme: input.theme,
        notifyDesktop: input.notifyDesktop,
        notifySound: input.notifySound,
        avatarData: input.avatarData === undefined ? current.avatarData : input.avatarData,
        initialized: true,
      };
      deps.db.saveSettings(session.email, settings);
      res.json(settings);
    }),
  );

  app.get(
    "/api/compose/new",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const settings = deps.db.getSettings(session.email);
      res.json({ html: newMessageHtml(settings.signatureHtml) });
    }),
  );

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, uploadDirectory(deps.config)),
      filename: (_req, _file, callback) => callback(null, crypto.randomUUID()),
    }),
    limits: { fileSize: deps.config.maxUploadBytes, files: 1, fields: 4 },
    fileFilter: (_req, file, callback) => {
      try {
        canonicalMime(file.originalname || "");
        callback(null, true);
      } catch (error) {
        callback(error as Error);
      }
    },
  }).single("file");

  app.post("/api/uploads", (req, res, next) => {
    upload(req, res, (error) => {
      if (error) next(error);
      else next();
    });
  }, asyncHandler(async (req, res) => {
    const session = requireSession(req);
    if (deps.uploadLimiter.tooMany(session.email)) {
      throw new HttpError(429, "Too many uploads. Wait and try again.", "rate_limited");
    }
    deps.uploadLimiter.hit(session.email);
    const file = req.file;
    if (!file) throw new HttpError(400, "Choose a file to upload.", "validation");
    const stored = safeUploadPath(deps.config, file.filename);
    const fail = async (error: unknown) => {
      if (stored) await fs.promises.rm(stored, { force: true });
      throw error;
    };
    try {
      if (!stored) throw new HttpError(400, "This file type is not allowed.", "unsupported_file");
      const handle = await fs.promises.open(stored, "r");
      const sample = Buffer.alloc(1024);
      const read = await handle.read(sample, 0, 1024, 0);
      await handle.close();
      assertFileContent(file.originalname, sample.subarray(0, read.bytesRead));
      if (deps.db.uploadBytes(session.email) + file.size > MAX_UPLOAD_QUOTA) {
        throw new HttpError(413, "Pending uploads exceed 200 MB. Remove some files first.", "payload_too_large");
      }
      const record = {
        id: file.filename,
        storedName: file.filename,
        originalName: sanitizeFilename(file.originalname),
        mime: canonicalMime(file.originalname),
        size: file.size,
        createdAt: Date.now(),
      };
      deps.db.createUpload(session.email, record);
      res.status(201).json({ id: record.id, name: record.originalName, mime: record.mime, size: record.size });
    } catch (error) {
      await fail(error);
    }
  }));

  app.delete(
    "/api/uploads/:id",
    asyncHandler(async (req, res) => {
      const session = requireSession(req);
      const removed = deps.db.deleteUpload(session.email, param(req, "id"));
      if (removed) removeUploadFile(deps.config, removed.storedName);
      res.status(204).end();
    }),
  );

}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

function readListQuery(req: Request): ListQuery {
  const offset = Number(queryValue(req.query.offset) || 0);
  const limit = Number(queryValue(req.query.limit) || 40);
  const filter = queryValue(req.query.filter) || "all";
  if (!["all", "unread", "starred", "attachments"].includes(filter)) {
    throw new HttpError(400, "Unknown filter.", "validation");
  }
  return {
    offset: Number.isFinite(offset) && offset >= 0 ? Math.min(Math.floor(offset), 100_000) : 0,
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 40,
    q: queryValue(req.query.q).replace(/[\u0000\r\n]/g, "").slice(0, 200),
    filter: filter as ListQuery["filter"],
  };
}

function requireBox(boxes: MailboxInfo[], mailboxPath: string) {
  const box = boxes.find((item) => item.path === mailboxPath);
  if (!box) throw new HttpError(404, "That folder is gone.", "not_found");
  return box;
}

async function collectUids(
  client: { listMessages: (path: string, query: ListQuery) => Promise<{ total: number; messages: Array<{ uid: number }> }> },
  mailboxPath: string,
  filter: ListQuery["filter"],
) {
  const uids: number[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const result = await client.listMessages(mailboxPath, { offset, limit: 50, q: "", filter });
    uids.push(...result.messages.map((item) => item.uid));
    offset += result.messages.length;
    if (!result.messages.length || offset >= result.total || uids.length >= 1000) break;
  }
  return uids;
}

async function buildOutbound(
  deps: AppDeps,
  email: string,
  client: { getAttachment: (path: string, uid: number, partId: string) => Promise<{ filename: string; mime: string; content: Buffer }> },
  input: SendInput,
  sending: boolean,
): Promise<{ message: OutboundMessage; recipients: string[]; uploadIds: string[] }> {
  const prepared = prepareOutgoingHtml(input.html || "");
  const uploadIds = [...new Set([...input.attachmentIds, ...prepared.inlineIds])];
  const inline = new Set(prepared.inlineIds);
  const attachments: OutboundMessage["attachments"] = [];
  let bytes = Buffer.byteLength(prepared.html);
  for (const id of uploadIds) {
    const file = readOwnedUpload(deps.db, deps.config, email, id);
    bytes += file.content.length;
    attachments.push({
      filename: file.record.originalName,
      content: file.content,
      mime: file.record.mime,
      cid: inline.has(id) ? `cid-${id}@securityblackrock.com` : undefined,
    });
  }
  if (input.forwardFrom) {
    const mailboxPath = decodeMailbox(input.forwardFrom.mailboxId);
    for (const partId of input.forwardFrom.partIds) {
      const file = await client.getAttachment(mailboxPath, input.forwardFrom.uid, assertPartId(partId));
      bytes += file.content.length;
      attachments.push({
        filename: sanitizeFilename(file.filename),
        content: file.content,
        mime: file.mime.split(";")[0] || "application/octet-stream",
      });
    }
  }
  if (bytes > MAX_MESSAGE_BYTES) {
    throw new HttpError(413, "This message is larger than 35 MB.", "payload_too_large");
  }
  const to = input.to.map(cleanAddress);
  const cc = input.cc.map(cleanAddress);
  const bcc = input.bcc.map(cleanAddress);
  if (sending && !prepared.text && !attachments.length) {
    throw new HttpError(400, "Write a message or attach a file.", "validation");
  }
  const settings = deps.db.getSettings(email);
  const messageId = normalizeMessageId(input.inReplyTo?.messageId);
  const message: OutboundMessage = {
    from: { name: cleanHeaderText(settings.displayName, 120), address: email },
    to,
    cc,
    bcc,
    subject: cleanHeaderText(input.subject, 500),
    html: prepared.html || "<p></p>",
    text: prepared.text,
    attachments,
    inReplyTo: messageId,
    references: referencesHeader(input.inReplyTo?.references || [], messageId),
  };
  const recipients = [...new Set([...to, ...cc, ...bcc].map((item) => item.address.toLowerCase()))];
  return { message, recipients, uploadIds };
}

function cleanAddress(address: { name?: string; address: string }): Address {
  return { name: cleanHeaderText(address.name || "", 120), address: address.address.trim() };
}

function discardUploads(deps: AppDeps, email: string, ids: string[]) {
  for (const id of ids) {
    const removed = deps.db.deleteUpload(email, id);
    if (removed) removeUploadFile(deps.config, removed.storedName);
  }
}
