import { z } from "zod";

const addressSchema = z.object({
  name: z.string().max(120).optional().default(""),
  address: z.string().trim().email().max(254),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
});

const messageFields = {
  to: z.array(addressSchema).max(50).optional().default([]),
  cc: z.array(addressSchema).max(50).optional().default([]),
  bcc: z.array(addressSchema).max(50).optional().default([]),
  subject: z.string().max(500).optional().default(""),
  html: z.string().max(1_500_000).optional().default(""),
  attachmentIds: z.array(z.string().uuid()).max(20).optional().default([]),
  inReplyTo: z
    .object({
      mailboxId: z.string().min(1).max(512),
      uid: z.number().int().positive(),
      messageId: z.string().max(220).nullable().optional(),
      references: z.array(z.string().max(220)).max(40).optional().default([]),
    })
    .optional(),
  forwardFrom: z
    .object({
      mailboxId: z.string().min(1).max(512),
      uid: z.number().int().positive(),
      partIds: z.array(z.string().regex(/^[1-9]\d{0,3}(\.[1-9]\d{0,3})*$/)).max(20),
    })
    .optional(),
  draftUid: z.number().int().positive().optional(),
};

export const sendSchema = z.object(messageFields).superRefine((value, context) => {
  const count = value.to.length + value.cc.length + value.bcc.length;
  if (count === 0) context.addIssue({ code: "custom", path: ["to"], message: "Add at least one recipient." });
  if (count > 50) context.addIssue({ code: "custom", path: ["to"], message: "Use 50 recipients or fewer." });
});

export const draftSchema = z.object(messageFields);

export const flagSchema = z.object({
  uids: z.array(z.number().int().positive()).min(1).max(200),
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
});

export const moveSchema = z.object({
  uids: z.array(z.number().int().positive()).min(1).max(200),
  destinationId: z.string().min(1).max(512),
});

export const deleteSchema = z.object({
  uids: z.array(z.number().int().positive()).min(1).max(200),
});

export const folderSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

const AVATAR_BYTES = 200 * 1024;

function validAvatar(value: string) {
  if (value === "") return true;
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length === 0 || bytes.length > AVATAR_BYTES) return false;
  const kind = match[1].toLowerCase();
  if (kind === "png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === "jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (kind === "gif") {
    const header = bytes.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  return bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export const settingsSchema = z.object({
  displayName: z.string().trim().max(120),
  signatureHtml: z.string().max(20_000),
  language: z.enum(["en", "es"]),
  timeZone: z.string().refine((zone) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone."),
  theme: z.enum(["light", "dark"]),
  notifyDesktop: z.boolean(),
  notifySound: z.boolean(),
  avatarData: z
    .string()
    .max(280_000)
    .refine(validAvatar, "Use a PNG, JPEG, WEBP, or GIF image under 200 KB.")
    .optional(),
});

export type SendInput = z.infer<typeof sendSchema>;
