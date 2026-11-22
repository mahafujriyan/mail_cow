export type Role = "inbox" | "sent" | "drafts" | "archive" | "junk" | "trash" | "custom";

export type Address = {
  name: string;
  address: string;
};

export type MailboxInfo = {
  id: string;
  path: string;
  name: string;
  role: Role;
  total: number;
  unseen: number;
  selectable: boolean;
};

export type ListQuery = {
  offset: number;
  limit: number;
  q: string;
  filter: "all" | "unread" | "starred" | "attachments";
};

export type MessageSummary = {
  uid: number;
  subject: string;
  from: Address[];
  to: Address[];
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  hasAttachments: boolean;
  preview: string;
  size: number;
};

export type RawAttachment = {
  partId: string;
  filename: string;
  mime: string;
  size: number;
  contentId: string | null;
  inline: boolean;
  content?: Buffer;
};

export type AttachmentInfo = Omit<RawAttachment, "content">;

export type RawMessage = MessageSummary & {
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  messageId: string | null;
  references: string[];
  html: string | null;
  text: string | null;
  attachments: RawAttachment[];
};

export type PresentedMessage = MessageSummary & {
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  messageId: string | null;
  references: string[];
  html: string;
  text: string;
  attachments: AttachmentInfo[];
  remoteImagesBlocked: boolean;
};

export type MessagePage = {
  total: number;
  offset: number;
  limit: number;
  capped: boolean;
  messages: MessageSummary[];
};

export type FlagChanges = {
  seen?: boolean;
  flagged?: boolean;
  answered?: boolean;
};

export type ReplyMode = "reply" | "replyAll" | "forward";

export type ReplyTemplate = {
  mode: ReplyMode;
  to: Address[];
  cc: Address[];
  subject: string;
  html: string;
  forwardParts: AttachmentInfo[];
  source: {
    mailboxId: string;
    uid: number;
    messageId: string | null;
    references: string[];
  };
};

export interface MailboxClient {
  listMailboxes(): Promise<MailboxInfo[]>;
  listMessages(path: string, query: ListQuery): Promise<MessagePage>;
  getMessage(path: string, uid: number): Promise<RawMessage>;
  setFlags(path: string, uids: number[], changes: FlagChanges): Promise<void>;
  move(path: string, uids: number[], destination: string): Promise<void>;
  remove(path: string, uids: number[], trashPath: string | null): Promise<void>;
  append(path: string, raw: Buffer, flags: string[]): Promise<number | null>;
  createMailbox(name: string): Promise<void>;
  renameMailbox(path: string, nextPath: string): Promise<void>;
  deleteMailbox(path: string): Promise<void>;
  getAttachment(
    path: string,
    uid: number,
    partId: string,
  ): Promise<{ filename: string; mime: string; content: Buffer }>;
  inboxSummary(): Promise<{ unseen: number; total: number }>;
  close(): Promise<void>;
}
