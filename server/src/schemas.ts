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
});

export type SendInput = z.infer<typeof sendSchema>;
