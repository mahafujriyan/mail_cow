export type Address = { name: string; address: string };

export type Mailbox = {
  id: string;
  path: string;
  name: string;
  role: "inbox" | "sent" | "drafts" | "archive" | "junk" | "trash" | "custom";
  total: number;
  unseen: number;
  selectable: boolean;
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

export type Attachment = {
  partId: string;
  filename: string;
  mime: string;
  size: number;
  contentId: string | null;
  inline: boolean;
};

export type MessageDetail = MessageSummary & {
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  messageId: string | null;
  references: string[];
  html: string;
  text: string;
  attachments: Attachment[];
  remoteImagesBlocked: boolean;
};

export type MessagePage = {
  total: number;
  offset: number;
  limit: number;
  capped: boolean;
  messages: MessageSummary[];
};

export type Settings = {
  displayName: string;
  signatureHtml: string;
  language: "en" | "es";
  timeZone: string;
  theme: "light" | "dark";
  notifyDesktop: boolean;
  notifySound: boolean;
  avatarData: string;
  initialized: boolean;
};

export type SessionUser = {
  email: string;
  demo: boolean;
  settings: Settings;
};

export type Contact = {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  notes: string;
};

export type ReplyTemplate = {
  mode: "reply" | "replyAll" | "forward";
  to: Address[];
  cc: Address[];
  subject: string;
  html: string;
  forwardParts: Attachment[];
  source: { mailboxId: string; uid: number; messageId: string | null; references: string[] };
};

export type UploadResult = { id: string; name: string; mime: string; size: number };
