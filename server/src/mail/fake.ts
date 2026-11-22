import { simpleParser } from "mailparser";

export const DEMO_EMAIL = "support@securityblackrock.com";
export const DEMO_PASSWORD = "local-demo-only";
import { HttpError } from "../errors.js";
import { encodeMailbox } from "./ids.js";
import { parsedToRaw } from "./parse.js";
import { toSummary } from "./present.js";
import type {
  Address,
  FlagChanges,
  ListQuery,
  MailboxClient,
  MailboxInfo,
  RawMessage,
  Role,
} from "./types.js";

type Folder = {
  path: string;
  name: string;
  role: Role;
  messages: RawMessage[];
};

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export function createFakeMailbox(): MailboxClient {
  let nextUid = 500;
  const folders: Folder[] = [
    { path: "INBOX", name: "INBOX", role: "inbox", messages: inboxMessages() },
    { path: "Sent", name: "Sent", role: "sent", messages: [] },
    { path: "Drafts", name: "Drafts", role: "drafts", messages: [] },
    { path: "Archive", name: "Archive", role: "archive", messages: [] },
    { path: "Junk", name: "Junk", role: "junk", messages: [spamMessage()] },
    { path: "Trash", name: "Trash", role: "trash", messages: [] },
    { path: "Receipts", name: "Receipts", role: "custom", messages: [] },
  ];

  function folder(path: string) {
    const found = folders.find((item) => item.path === path);
    if (!found) throw new HttpError(404, "That folder or message is gone.", "not_found");
    return found;
  }

  function message(path: string, uid: number) {
    const found = folder(path).messages.find((item) => item.uid === uid);
    if (!found) throw new HttpError(404, "That message is gone.", "not_found");
    return found;
  }

  return {
    async listMailboxes(): Promise<MailboxInfo[]> {
      return folders.map((item) => ({
        id: encodeMailbox(item.path),
        path: item.path,
        name: item.name,
        role: item.role,
        total: item.messages.length,
        unseen: item.messages.filter((entry) => !entry.seen).length,
        selectable: true,
      }));
    },
    async listMessages(path, query: ListQuery) {
      const items = folder(path).messages.filter((entry) => matches(entry, query));
      const page = items.slice(query.offset, query.offset + query.limit).map(toSummary);
      return { total: items.length, offset: query.offset, limit: query.limit, capped: false, messages: page };
    },
    async getMessage(path, uid) {
      return structuredCloneMessage(message(path, uid));
    },
    async setFlags(path, uids, changes: FlagChanges) {
      for (const uid of uids) {
        const item = message(path, uid);
        if (changes.seen !== undefined) item.seen = changes.seen;
        if (changes.flagged !== undefined) item.flagged = changes.flagged;
        if (changes.answered !== undefined) item.answered = changes.answered;
      }
    },
    async move(path, uids, destination) {
      const source = folder(path);
      const target = folder(destination);
      source.messages = source.messages.filter((item) => {
        if (!uids.includes(item.uid)) return true;
        target.messages.unshift(item);
        return false;
      });
    },
    async remove(path, uids, trashPath) {
      if (trashPath && trashPath !== path) {
        await this.move(path, uids, trashPath);
        return;
      }
      const source = folder(path);
      source.messages = source.messages.filter((item) => !uids.includes(item.uid));
    },
    async append(path, raw, flags) {
      const parsed = await simpleParser(raw, { skipImageLinks: true });
      const uid = nextUid++;
      const item = parsedToRaw(parsed, { uid, flags, size: raw.length, date: new Date() });
      folder(path).messages.unshift(item);
      return uid;
    },
    async createMailbox(name) {
      if (folders.some((item) => item.path.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(400, "A folder with that name already exists.", "validation");
      }
      folders.push({ path: name, name, role: "custom", messages: [] });
    },
    async renameMailbox(path, nextPath) {
      const item = folder(path);
      if (item.role !== "custom") throw new HttpError(400, "That folder cannot be renamed.", "validation");
      item.path = nextPath;
      item.name = nextPath;
    },
    async deleteMailbox(path) {
      const item = folder(path);
      if (item.role !== "custom") throw new HttpError(400, "That folder cannot be deleted.", "validation");
      const index = folders.findIndex((entry) => entry.path === path);
      if (index >= 0) folders.splice(index, 1);
    },
    async getAttachment(path, uid, partId) {
      const attachment = message(path, uid).attachments.find((item) => item.partId === partId);
      if (!attachment?.content) throw new HttpError(404, "That attachment is gone.", "not_found");
      return { filename: attachment.filename, mime: attachment.mime, content: attachment.content };
    },
    async inboxSummary() {
      const inbox = folder("INBOX");
      return { total: inbox.messages.length, unseen: inbox.messages.filter((item) => !item.seen).length };
    },
    async close() {
      return undefined;
    },
  };
}

function matches(message: RawMessage, query: ListQuery) {
  if (query.filter === "unread" && message.seen) return false;
  if (query.filter === "starred" && !message.flagged) return false;
  if (query.filter === "attachments" && !message.hasAttachments) return false;
  if (!query.q) return true;
  const haystack = [message.subject, message.preview, message.text || "", ...message.from.map((item) => `${item.name} ${item.address}`)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.q.toLowerCase());
}

function structuredCloneMessage(message: RawMessage): RawMessage {
  return {
    ...message,
    from: message.from.map(cloneAddress),
    to: message.to.map(cloneAddress),
    cc: message.cc.map(cloneAddress),
    bcc: message.bcc.map(cloneAddress),
    replyTo: message.replyTo.map(cloneAddress),
    references: [...message.references],
    attachments: message.attachments.map((attachment) => ({ ...attachment, content: attachment.content })),
  };
}

function cloneAddress(address: Address): Address {
  return { name: address.name, address: address.address };
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function base(partial: Partial<RawMessage> & Pick<RawMessage, "uid" | "subject" | "from">): RawMessage {
  return {
    to: [{ name: "Security Blackrock Support", address: "support@securityblackrock.com" }],
    cc: [],
    bcc: [],
    replyTo: [],
    date: partial.date || hoursAgo(2),
    seen: partial.seen ?? false,
    flagged: partial.flagged ?? false,
    answered: false,
    draft: false,
    hasAttachments: partial.hasAttachments ?? false,
    preview: partial.preview || "",
    size: partial.size || 2400,
    messageId: partial.messageId || `<${partial.uid}@demo.securityblackrock.com>`,
    references: [],
    html: partial.html || null,
    text: partial.text || null,
    attachments: partial.attachments || [],
    ...partial,
  };
}

function inboxMessages(): RawMessage[] {
  return [
    base({
      uid: 101,
      subject: "VPN access for the audit team",
      from: [{ name: "Aria Rahman", address: "aria.rahman@securityblackrock.com" }],
      date: hoursAgo(1),
      seen: false,
      preview: "The auditors need access before Thursday. I listed the three accounts in the note below.",
      text: "The auditors need access before Thursday. I listed the three accounts in the note below.",
      html: "<p>The auditors need access before Thursday. I listed the three accounts in the note below.</p><p>Can you confirm the group is ready?</p>",
    }),
    base({
      uid: 102,
      subject: "Invoice 1842 is ready",
      from: [{ name: "Billing", address: "billing@northline.example" }],
      date: hoursAgo(5),
      seen: false,
      flagged: true,
      preview: "Invoice 1842 for the March retainer is attached as a note. Payment is due on the 28th.",
      text: "Invoice 1842 for the March retainer is ready. Payment is due on the 28th.",
      html: "<p>Invoice 1842 for the March retainer is ready. Payment is due on the 28th.</p>",
    }),
    base({
      uid: 103,
      subject: "Signed DPA",
      from: [{ name: "Daniel Okonkwo", address: "daniel@harborlegal.example" }],
      date: hoursAgo(26),
      seen: true,
      hasAttachments: true,
      preview: "Attached is the countersigned data processing addendum.",
      text: "Attached is the countersigned data processing addendum.",
      html: '<p>Attached is the countersigned data processing addendum.</p><p><img src="cid:pixel@demo" alt=""></p>',
      attachments: [
        {
          partId: "2",
          filename: "dpa-notes.txt",
          mime: "text/plain",
          size: 42,
          contentId: null,
          inline: false,
          content: Buffer.from("Countersigned DPA notes for the support desk.\n", "utf8"),
        },
        {
          partId: "1.2",
          filename: "pixel.png",
          mime: "image/png",
          size: PIXEL.length,
          contentId: "pixel@demo",
          inline: true,
          content: PIXEL,
        },
      ],
    }),
    base({
      uid: 104,
      subject: "Maintenance window Saturday",
      from: [{ name: "Platform", address: "platform@securityblackrock.com" }],
      date: hoursAgo(50),
      seen: true,
      preview: "Mail will stay online. The admin panel will be read-only from 01:00 to 03:00 UTC.",
      text: "Mail will stay online. The admin panel will be read-only from 01:00 to 03:00 UTC.",
      html: "<p>Mail will stay online. The admin panel will be read-only from 01:00 to 03:00 UTC.</p>",
    }),
  ];
}

function spamMessage(): RawMessage {
  return base({
    uid: 301,
    subject: "Your mailbox will be closed",
    from: [{ name: "Security Notice", address: "notice@example.invalid" }],
    seen: false,
    preview: "A suspicious notice that should render as plain content only.",
    text: "This is a suspicious notice.",
    html: `<p>Please review the window.</p>
      <script>alert("xss")</script>
      <img src="x" onerror="alert(1)">
      <a href="javascript:alert(1)">click</a>
      <img src="https://example.com/pixel.png" alt="tracker">
      <div style="position:fixed;top:0;left:0;background:url(https://example.com/a)">overlay</div>`,
  });
}
