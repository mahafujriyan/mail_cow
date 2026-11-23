"use client";

import DOMPurify from "dompurify";
import { Paperclip, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MailEditor } from "@/components/editor";
import { ApiError, api, uploadFile } from "@/lib/api";
import { useCompose } from "@/lib/compose";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Address, Attachment, ReplyTemplate, UploadResult } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

type Chip = Address;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ComposeModal({ onSent }: { onSent: () => void }) {
  const { request, closeCompose } = useCompose();
  const { user } = useSession();
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const open = Boolean(request);

  return (
    <AnimatePresence>
      {open && request && user && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[#121614]/30 p-3 sm:p-6"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button className="absolute inset-0" aria-label={t("close")} onClick={closeCompose} />
          <ComposeSheet key={`${request.mode}:${request.folderId || ""}:${request.uid || ""}`} request={request} onSent={onSent} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ComposeSheet({
  request,
  onSent,
}: {
  request: { mode: "new" | "reply" | "replyAll" | "forward"; folderId?: string; uid?: number };
  onSent: () => void;
}) {
  const { closeCompose } = useCompose();
  const { user } = useSession();
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [to, setTo] = useState<Chip[]>([]);
  const [cc, setCc] = useState<Chip[]>([]);
  const [bcc, setBcc] = useState<Chip[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("<p></p>");
  const [seed, setSeed] = useState("<p></p>");
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const [forwardParts, setForwardParts] = useState<Attachment[]>([]);
  const [source, setSource] = useState<ReplyTemplate["source"] | null>(null);
  const [draftUid, setDraftUid] = useState<number | undefined>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [signatureInBody, setSignatureInBody] = useState(false);
  const dirty = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (request.mode === "new") {
        const fresh = await api<{ html: string }>("/api/compose/new");
        if (cancelled) return;
        setSeed(fresh.html);
        setHtml(fresh.html);
        setSignatureInBody(true);
      } else if (request.folderId && request.uid) {
        const template = await api<ReplyTemplate>(
          `/api/mailboxes/${request.folderId}/messages/${request.uid}/reply?mode=${request.mode}`,
        );
        if (cancelled) return;
        setTo(template.to);
        setCc(template.cc);
        setShowCc(template.cc.length > 0);
        setSubject(template.subject);
        setSeed(template.html);
        setHtml(template.html);
        setForwardParts(template.forwardParts);
        setSource(template.source);
        setSignatureInBody(true);
      }
      if (!cancelled) setReady(true);
    }
    void load().catch((caught) => {
      if (!cancelled) setError(caught instanceof ApiError ? caught.message : t("couldNotLoad"));
    });
    return () => {
      cancelled = true;
    };
  }, [request.mode, request.folderId, request.uid, t]);

  const signature = request.mode === "new" ? user?.settings.signatureHtml?.trim() || "" : "";
  const outboundHtml =
    signatureInBody || !signature || html.includes(signature) ? html : `${html}<p></p>${signature}`;

  const payload = useMemo(
    () => ({
      to,
      cc,
      bcc,
      subject,
      html: outboundHtml,
      attachmentIds: uploads.map((file) => file.id),
      draftUid,
      inReplyTo: source || undefined,
      forwardFrom:
        request.mode === "forward" && source
          ? { mailboxId: source.mailboxId, uid: source.uid, partIds: forwardParts.map((part) => part.partId) }
          : undefined,
    }),
    [to, cc, bcc, subject, outboundHtml, uploads, draftUid, source, request.mode, forwardParts],
  );

  useEffect(() => {
    if (!ready || !dirty.current) return;
    const timer = window.setTimeout(async () => {
      setStatus(t("draftSaving"));
      try {
        const saved = await api<{ uid: number | null }>("/api/drafts", { method: "POST", json: payload });
        if (saved.uid) setDraftUid(saved.uid);
        setStatus(t("draftSaved"));
        dirty.current = false;
      } catch {
        setStatus(t("draftFailed"));
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [payload, ready, t]);

  function markDirty() {
    dirty.current = true;
  }

  async function addFiles(files: File[]) {
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        setError(file.name);
        continue;
      }
      const uploaded = await uploadFile(file);
      setUploads((current) => [...current, uploaded]);
      markDirty();
    }
  }

  async function send() {
    if (to.length + cc.length + bcc.length === 0) {
      setError(t("needRecipient"));
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await api<{ sent: boolean; savedToSent: boolean }>("/api/messages/send", {
        method: "POST",
        json: payload,
      });
      setStatus(result.savedToSent ? t("sentOk") : t("sentWarn"));
      onSent();
      closeCompose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("couldNotLoad"));
    } finally {
      setSending(false);
    }
  }

  return (
    <motion.section
      role="dialog"
      aria-label={t("compose")}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16 }}
      className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgb(18_36_30/0.16)]"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addFiles([...event.dataTransfer.files]);
      }}
    >
      <div className="flex h-11 items-center justify-end px-2">
        <button type="button" aria-label={t("close")} onClick={closeCompose} className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas">
          <X className="h-4 w-4" />
        </button>
      </div>
      <Field label={t("from")}>
        <span className="text-sm">{user?.email}</span>
      </Field>
      <Field label={t("to")}>
        <RecipientField
          values={to}
          onChange={(next) => {
            setTo(next);
            markDirty();
          }}
        />
        <div className="ml-auto flex items-center gap-3">
          <button type="button" className="text-sm text-brand" onClick={() => setShowCc((value) => !value)}>
            {t("cc")}
          </button>
          <button type="button" className="text-sm text-brand" onClick={() => setShowBcc((value) => !value)}>
            {t("bcc")}
          </button>
        </div>
      </Field>
      {showCc && (
        <Field label={t("cc")}>
          <RecipientField values={cc} onChange={(next) => { setCc(next); markDirty(); }} />
        </Field>
      )}
      {showBcc && (
        <Field label={t("bcc")}>
          <RecipientField values={bcc} onChange={(next) => { setBcc(next); markDirty(); }} />
        </Field>
      )}
      <Field label={t("subject")}>
        <input
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            markDirty();
          }}
          className="w-full bg-transparent text-sm outline-none"
        />
      </Field>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ready && (
          <MailEditor
            seed={seed}
            seedKey={`${request.mode}:${request.uid || "new"}`}
            placeholder={t("writeHere")}
            onChange={(value) => {
              setHtml(value);
              markDirty();
            }}
            onUploadImage={async (file) => {
              const uploaded = await uploadFile(file);
              setUploads((current) => [...current, uploaded]);
              markDirty();
              return { id: uploaded.id, src: URL.createObjectURL(file) };
            }}
          />
        )}
        {!signatureInBody && signature && (
          <div
            className="border-t border-dashed border-line px-4 py-3 text-sm text-muted"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(signature) }}
          />
        )}
        {(uploads.length > 0 || forwardParts.length > 0) && (
          <ul className="flex flex-wrap gap-2 px-4 pb-3">
            {uploads.map((file) => (
              <li key={file.id} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs">
                <span className="max-w-[180px] truncate">{file.name}</span>
                <span className="text-muted">{formatBytes(file.size)}</span>
                <button type="button" aria-label={t("remove")} onClick={() => setUploads((current) => current.filter((item) => item.id !== file.id))}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
            {forwardParts.map((part) => (
              <li key={part.partId} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs">
                <span className="max-w-[180px] truncate">{part.filename}</span>
                <button type="button" aria-label={t("remove")} onClick={() => setForwardParts((current) => current.filter((item) => item.partId !== part.partId))}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dragging && <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border border-dashed border-brand bg-mint/80 text-sm text-brand">{t("dropFiles")}</div>}
      {error && <p className="px-4 pb-1 text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2 border-t border-line px-3 py-3">
        <button type="button" aria-label={t("attach")} onClick={() => fileRef.current?.click()} className="grid h-9 w-9 place-items-center rounded-md hover:bg-canvas">
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void addFiles([...(event.target.files || [])]);
            event.target.value = "";
          }}
        />
        <span className="text-xs text-muted">{status}</span>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-[#0e3329] disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {sending ? t("sending") : t("send")}
        </button>
      </div>
    </motion.section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-line px-4 py-2">
      <span className="w-14 shrink-0 text-sm text-muted">{label}</span>
      {children}
    </div>
  );
}

function RecipientField({ values, onChange }: { values: Chip[]; onChange: (next: Chip[]) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Chip[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = text.trim();
    if (query.length < 1) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api<{ suggestions: Array<{ name: string; address: string }> }>(`/api/contacts/suggest?q=${encodeURIComponent(query)}`)
        .then((data) => setSuggestions(data.suggestions))
        .catch(() => setSuggestions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [text]);

  function add(address: string, name = "") {
    const clean = address.trim().replace(/[;,]$/, "");
    if (!EMAIL.test(clean)) return;
    if (values.some((item) => item.address.toLowerCase() === clean.toLowerCase())) return;
    onChange([...values, { name, address: clean }]);
    setText("");
    setOpen(false);
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {values.map((chip) => (
        <span key={chip.address} className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-xs">
          {chip.name || chip.address}
          <button type="button" aria-label={t("remove")} onClick={() => onChange(values.filter((item) => item.address !== chip.address))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
            if (text.trim()) {
              event.preventDefault();
              add(text);
            }
          } else if (event.key === "Backspace" && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (text.trim()) add(text);
          window.setTimeout(() => setOpen(false), 150);
        }}
        className={cn("h-7 min-w-[120px] flex-1 bg-transparent text-sm outline-none")}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-sheet">
          {suggestions.map((item) => (
            <li key={item.address}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas"
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(item.address, item.name);
                }}
              >
                <span className="block">{item.name || item.address}</span>
                {item.name && <span className="text-xs text-muted">{item.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
