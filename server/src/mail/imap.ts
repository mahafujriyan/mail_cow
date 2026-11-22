import { ImapFlow, type FetchMessageObject, type MessageStructureObject, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { AppConfig } from "../config.js";
import { tlsOptions } from "../config.js";
import { HttpError } from "../errors.js";
import { encodeMailbox } from "./ids.js";
import { parsedToRaw } from "./parse.js";
import type {
  FlagChanges,
  ListQuery,
  MailboxClient,
  MailboxInfo,
  MessagePage,
  MessageSummary,
  RawMessage,
  Role,
} from "./types.js";

const MAX_OPEN_BYTES = 35 * 1024 * 1024;
const ROLE_ORDER: Role[] = ["inbox", "sent", "drafts", "archive", "junk", "trash", "custom"];

export class ImapMailbox implements MailboxClient {
  private client: ImapFlow | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly config: AppConfig,
    private readonly auth: { email: string; password: string },
  ) {}

  listMailboxes() {
    return this.enqueue((client) => this.readMailboxes(client));
  }

  listMessages(path: string, query: ListQuery) {
    return this.enqueue((client) => this.readMessages(client, path, query));
  }

  getMessage(path: string, uid: number) {
    return this.enqueue((client) => this.readMessage(client, path, uid));
  }

  setFlags(path: string, uids: number[], changes: FlagChanges) {
    return this.enqueue((client) => this.writeFlags(client, path, uids, changes));
  }

  move(path: string, uids: number[], destination: string) {
    return this.enqueue(async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        await client.messageMove(uids, destination, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  remove(path: string, uids: number[], trashPath: string | null) {
    if (trashPath && trashPath !== path) return this.move(path, uids, trashPath);
    return this.enqueue(async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        await client.messageDelete(uids, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  append(path: string, raw: Buffer, flags: string[]) {
    return this.enqueue(async (client) => {
      const result = await client.append(path, raw, flags);
      return result && result.uid ? result.uid : null;
    });
  }

  createMailbox(name: string) {
    return this.enqueue(async (client) => {
      await client.mailboxCreate(name);
    });
  }

  renameMailbox(path: string, nextPath: string) {
    return this.enqueue(async (client) => {
      await client.mailboxRename(path, nextPath);
    });
  }

  deleteMailbox(path: string) {
    return this.enqueue(async (client) => {
      await client.mailboxDelete(path);
    });
  }

  getAttachment(path: string, uid: number, partId: string) {
    return this.enqueue(async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        const downloaded = await client.download(String(uid), partId, { uid: true, maxBytes: MAX_OPEN_BYTES });
        const content = await readStream(downloaded.content);
        return {
          filename: downloaded.meta.filename || "attachment",
          mime: downloaded.meta.contentType || "application/octet-stream",
          content,
        };
      } finally {
        lock.release();
      }
    });
  }

  inboxSummary() {
    return this.enqueue(async (client) => {
      const boxes = await client.list();
      const inbox = boxes.find((box) => roleOf(box) === "inbox") || boxes.find((box) => box.path.toLowerCase() === "inbox");
      if (!inbox) return { unseen: 0, total: 0 };
      const status = await client.status(inbox.path, { messages: true, unseen: true });
      return { unseen: status.unseen || 0, total: status.messages || 0 };
    });
  }

  async close() {
    this.closed = true;
    await this.reset();
  }

  private enqueue<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const run = this.chain.then(() => this.withClient(fn));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>, retry = true): Promise<T> {
    const client = await this.ensure();
    try {
      return await fn(client);
    } catch (error) {
      if (retry && !isAuthError(error) && !client.usable) {
        await this.reset();
        return this.withClient(fn, false);
      }
      throw error;
    }
  }

  private async ensure(): Promise<ImapFlow> {
    if (this.closed) throw new HttpError(401, "Sign in again.", "unauthorized");
    if (this.client?.usable) return this.client;
    await this.reset();
    const client = new ImapFlow({
      host: this.config.mailHost,
      port: this.config.imapPort,
      secure: true,
      servername: this.config.mailHost,
      auth: { user: this.auth.email, pass: this.auth.password },
      logger: false,
      logRaw: false,
      emitLogs: false,
      disableAutoIdle: true,
      tls: tlsOptions(this.config),
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 120_000,
    });
    client.on("error", () => undefined);
    await client.connect();
    this.client = client;
    return client;
  }

  private async reset() {
    const current = this.client;
    this.client = null;
    if (!current) return;
    try {
      await current.logout();
    } catch {
      current.close();
    }
  }

  private async readMailboxes(client: ImapFlow): Promise<MailboxInfo[]> {
    const boxes = await client.list();
    const result: MailboxInfo[] = [];
    for (const box of boxes) {
      const selectable = !hasFlag(box.flags, "\\Noselect");
      let total = 0;
      let unseen = 0;
      if (selectable) {
        try {
          const status = await client.status(box.path, { messages: true, unseen: true });
          total = status.messages || 0;
          unseen = status.unseen || 0;
        } catch {
          total = 0;
          unseen = 0;
        }
      }
      result.push({
        id: encodeMailbox(box.path),
        path: box.path,
        name: box.name || box.path,
        role: roleOf(box),
        total,
        unseen,
        selectable,
      });
    }
    return result.sort((a, b) => {
      const roleDelta = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
      if (roleDelta !== 0) return roleDelta;
      return a.name.localeCompare(b.name);
    });
  }

  private async readMessages(client: ImapFlow, path: string, query: ListQuery): Promise<MessagePage> {
    const lock = await client.getMailboxLock(path);
    try {
      const found = await client.search(searchFor(query), { uid: true });
      const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a);
      let matched = uids;
      let capped = false;
      if (query.filter === "attachments") {
        const scan = uids.slice(0, 1000);
        capped = uids.length > scan.length;
        const withFiles: number[] = [];
        if (scan.length) {
          const structures = await client.fetchAll(scan, { uid: true, bodyStructure: true }, { uid: true });
          for (const item of structures) {
            if (hasFileAttachment(item.bodyStructure)) withFiles.push(item.uid);
          }
        }
        matched = withFiles.sort((a, b) => b - a);
      }
      const pageUids = matched.slice(query.offset, query.offset + query.limit);
      const messages = pageUids.length ? await this.fetchSummaries(client, pageUids) : [];
      messages.sort((a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""));
      return { total: matched.length, offset: query.offset, limit: query.limit, capped, messages };
    } finally {
      lock.release();
    }
  }

  private async fetchSummaries(client: ImapFlow, uids: number[]): Promise<MessageSummary[]> {
    const base = {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
    } as const;
    let rows: FetchMessageObject[];
    try {
      rows = await client.fetchAll(
        uids,
        { ...base, bodyParts: [{ key: "1", maxLength: 700 }, { key: "1.1", maxLength: 700 }, { key: "1.2", maxLength: 700 }] },
        { uid: true },
      );
    } catch {
      rows = await client.fetchAll(uids, base, { uid: true });
    }
    return rows.map(summaryFromFetch);
  }

  private async readMessage(client: ImapFlow, path: string, uid: number): Promise<RawMessage> {
    const lock = await client.getMailboxLock(path);
    try {
      const meta = await client.fetchOne(
        String(uid),
        { uid: true, flags: true, envelope: true, internalDate: true, size: true, bodyStructure: true },
        { uid: true },
      );
      if (!meta) throw new HttpError(404, "That message is gone.", "not_found");
      if ((meta.size || 0) > MAX_OPEN_BYTES) {
        const summary = summaryFromFetch(meta);
        return {
          ...summary,
          cc: mapEnvelope(meta.envelope?.cc),
          bcc: mapEnvelope(meta.envelope?.bcc),
          replyTo: mapEnvelope(meta.envelope?.replyTo),
          messageId: meta.envelope?.messageId || null,
          references: [],
          html: null,
          text: "This message is too large to open here. Download the attachments instead.",
          attachments: attachmentsFromStructure(meta.bodyStructure),
        };
      }
      const downloaded = await client.download(String(uid), undefined, { uid: true, maxBytes: MAX_OPEN_BYTES });
      const parsed = await simpleParser(downloaded.content, { skipImageLinks: true });
      return parsedToRaw(parsed, {
        uid,
        flags: meta.flags,
        date: parsed.date || toDate(meta.envelope?.date || meta.internalDate),
        size: meta.size,
      });
    } finally {
      lock.release();
    }
  }

  private async writeFlags(client: ImapFlow, path: string, uids: number[], changes: FlagChanges) {
    const lock = await client.getMailboxLock(path);
    try {
      if (changes.seen === true) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      if (changes.seen === false) await client.messageFlagsRemove(uids, ["\\Seen"], { uid: true });
      if (changes.flagged === true) await client.messageFlagsAdd(uids, ["\\Flagged"], { uid: true });
      if (changes.flagged === false) await client.messageFlagsRemove(uids, ["\\Flagged"], { uid: true });
      if (changes.answered === true) await client.messageFlagsAdd(uids, ["\\Answered"], { uid: true });
    } finally {
      lock.release();
    }
  }
}

export async function verifyMailboxLogin(config: AppConfig, email: string, password: string) {
  const client = new ImapFlow({
    host: config.mailHost,
    port: config.imapPort,
    secure: true,
    servername: config.mailHost,
    auth: { user: email, pass: password },
    logger: false,
    logRaw: false,
    emitLogs: false,
    verifyOnly: true,
    disableAutoIdle: true,
    tls: tlsOptions(config),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export function classifyMailError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const record = error as { authenticationFailed?: boolean; code?: string; message?: string; responseCode?: number };
  if (record.authenticationFailed || record.code === "EAUTH" || record.responseCode === 535) {
    return new HttpError(401, "Invalid email or password.", "invalid_credentials");
  }
  const detail = `${record.code || ""} ${record.message || ""}`;
  if (/certificate|self-signed|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_TLS/i.test(detail)) {
    return new HttpError(503, "The secure connection to the mail server was rejected.", "tls_failed");
  }
  if (/timed out|timeout|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|CONNECT_TIMEOUT/i.test(detail)) {
    return new HttpError(503, "The mail server is unreachable.", "mail_unavailable");
  }
  if (/doesn't exist|does not exist|NONEXISTENT|No such mailbox/i.test(detail)) {
    return new HttpError(404, "That folder or message is gone.", "not_found");
  }
  return new HttpError(502, "The mail server could not complete that request.", "mail_unavailable");
}

function searchFor(query: ListQuery): SearchObject {
  const criteria: SearchObject = { deleted: false };
  if (query.filter === "unread") criteria.seen = false;
  if (query.filter === "starred") criteria.flagged = true;
  if (query.q) {
    criteria.or = [{ from: query.q }, { to: query.q }, { subject: query.q }, { body: query.q }];
  }
  return criteria;
}

function summaryFromFetch(message: FetchMessageObject): MessageSummary {
  const flags = message.flags || new Set<string>();
  const date = message.envelope?.date || message.internalDate;
  return {
    uid: message.uid,
    subject: message.envelope?.subject || "",
    from: mapEnvelope(message.envelope?.from),
    to: mapEnvelope(message.envelope?.to),
    date: date ? new Date(date).toISOString() : null,
    seen: hasFlag(flags, "\\Seen"),
    flagged: hasFlag(flags, "\\Flagged"),
    answered: hasFlag(flags, "\\Answered"),
    draft: hasFlag(flags, "\\Draft"),
    hasAttachments: hasFileAttachment(message.bodyStructure),
    preview: previewFromParts(message.bodyParts),
    size: message.size || 0,
  };
}

function mapEnvelope(value: Array<{ name?: string; address?: string }> | undefined) {
  return (value || [])
    .filter((item) => item.address)
    .map((item) => ({ name: item.name || "", address: item.address || "" }));
}

function hasFlag(flags: Iterable<string> | undefined, flag: string) {
  if (!flags) return false;
  const target = flag.toLowerCase();
  for (const item of flags) {
    if (item.toLowerCase() === target) return true;
  }
  return false;
}

function roleOf(box: { path: string; specialUse?: string }): Role {
  const use = (box.specialUse || "").toLowerCase();
  const mailboxPath = box.path.toLowerCase();
  if (use === "\\inbox" || mailboxPath === "inbox") return "inbox";
  if (use === "\\sent" || mailboxPath === "sent") return "sent";
  if (use === "\\drafts" || mailboxPath === "drafts") return "drafts";
  if (use === "\\junk" || mailboxPath === "junk" || mailboxPath === "spam") return "junk";
  if (use === "\\trash" || mailboxPath === "trash") return "trash";
  if (use === "\\archive" || mailboxPath === "archive") return "archive";
  return "custom";
}

function hasFileAttachment(node: MessageStructureObject | undefined): boolean {
  let found = false;
  const walk = (part?: MessageStructureObject) => {
    if (!part || found) return;
    if (part.childNodes?.length) {
      part.childNodes.forEach(walk);
      return;
    }
    const disposition = (part.disposition || "").toLowerCase();
    const filename = part.dispositionParameters?.filename || part.parameters?.name;
    const type = (part.type || "").toLowerCase();
    if (disposition === "attachment") found = true;
    else if (filename && !type.startsWith("text/") && disposition !== "inline") found = true;
  };
  walk(node);
  return found;
}

function attachmentsFromStructure(node: MessageStructureObject | undefined) {
  const items: RawMessage["attachments"] = [];
  const walk = (part?: MessageStructureObject) => {
    if (!part) return;
    if (part.childNodes?.length) {
      part.childNodes.forEach(walk);
      return;
    }
    const disposition = (part.disposition || "").toLowerCase();
    const filename = part.dispositionParameters?.filename || part.parameters?.name || "";
    const inline = disposition === "inline" || Boolean(part.id);
    if (disposition !== "attachment" && !filename) return;
    if (!part.part) return;
    items.push({
      partId: part.part,
      filename: filename || "attachment",
      mime: (part.type || "application/octet-stream").toLowerCase(),
      size: part.size || 0,
      contentId: part.id ? part.id.replace(/[<>]/g, "") : null,
      inline,
    });
  };
  walk(node);
  return items;
}

function previewFromParts(parts?: Map<string, Buffer>): string {
  if (!parts) return "";
  for (const key of ["1.1", "1.2", "1", "2"]) {
    const value = parts.get(key);
    if (!value) continue;
    const text = value.toString("utf8").replace(/\u0000/g, "");
    const stripped = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!stripped) continue;
    const sample = stripped.slice(0, 80);
    const control = [...sample].filter((char) => char.charCodeAt(0) < 32).length;
    if (control > 2) continue;
    return stripped.slice(0, 180);
  }
  return "";
}

function toDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isAuthError(error: unknown) {
  return Boolean((error as { authenticationFailed?: boolean }).authenticationFailed);
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
