"use client";

import DOMPurify from "dompurify";
import {
  Archive,
  ChevronLeft,
  Forward,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ComposeModal } from "@/components/mail/compose-modal";
import { api } from "@/lib/api";
import { useCompose } from "@/lib/compose";
import { dayGroup, formatFull, formatWhen } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Mailbox, MessageDetail, MessagePage, MessageSummary } from "@/lib/types";
import { cn, formatBytes, initials, personLabel, toneFor } from "@/lib/utils";

const PAGE = 40;

export function MailScreen({ folderId, uid, q }: { folderId?: string; uid?: number; q: string }) {
  const { t, language } = useI18n();
  const { user } = useSession();
  const { openCompose } = useCompose();
  const router = useRouter();
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [page, setPage] = useState<MessagePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState<MessageDetail | null>(null);
  const [error, setError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [view, setView] = useState<"html" | "plain">("html");
  const [showRemote, setShowRemote] = useState(false);
  const [tick, setTick] = useState(0);
  const listGen = useRef(0);
  const timeZone = user?.settings.timeZone || "UTC";
  const scope = `${folderId || ""}|${q}`;
  const [pageScope, setPageScope] = useState(scope);
  if (pageScope !== scope) {
    setPageScope(scope);
    if (offset !== 0) setOffset(0);
  }
  const activeOffset = pageScope === scope ? offset : 0;

  const folder = boxes.find((box) => box.id === folderId) || boxes.find((box) => box.role === "inbox");

  function reload() {
    setTick((value) => value + 1);
    window.dispatchEvent(new Event("sbr-mailboxes"));
  }

  useEffect(() => {
    let cancelled = false;
    void api<{ mailboxes: Mailbox[] }>("/api/mailboxes")
      .then((data) => {
        if (cancelled) return;
        setBoxes(data.mailboxes);
        if (!folderId) {
          const inbox = data.mailboxes.find((box) => box.role === "inbox");
          if (inbox) router.replace(q ? `/mail/${inbox.id}?q=${encodeURIComponent(q)}` : `/mail/${inbox.id}`);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("couldNotLoad"));
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, q, router, t, tick]);

  useEffect(() => {
    if (!folder || pageScope !== scope) return;
    const gen = ++listGen.current;
    const mailboxId = folder.id;
    setLoadingList(true);
    setError("");
    void api<MessagePage>(`/api/mailboxes/${mailboxId}/messages?offset=${activeOffset}&limit=${PAGE}&q=${encodeURIComponent(q)}`)
      .then((data) => {
        if (gen !== listGen.current) return;
        if (data.messages.length === 0 && activeOffset > 0) {
          setOffset(0);
          return;
        }
        setPage(data);
      })
      .catch((caught) => {
        if (gen !== listGen.current) return;
        setError(caught instanceof Error ? caught.message : t("couldNotLoad"));
      })
      .finally(() => {
        if (gen === listGen.current) setLoadingList(false);
      });
  }, [folder?.id, activeOffset, q, tick, pageScope, scope, t]);

  useEffect(() => {
    setShowRemote(false);
  }, [folder?.id, uid]);

  useEffect(() => {
    if (!folder || !uid) {
      setMessage(null);
      return;
    }
    let cancelled = false;
    void api<MessageDetail>(`/api/mailboxes/${folder.id}/messages/${uid}${showRemote ? "?remoteImages=1" : ""}`)
      .then((data) => {
        if (cancelled) return;
        setMessage(data);
        setView(data.html ? "html" : "plain");
        setPage((current) =>
          current
            ? { ...current, messages: current.messages.map((item) => (item.uid === data.uid ? { ...item, seen: true } : item)) }
            : current,
        );
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("couldNotLoad"));
      });
    return () => {
      cancelled = true;
    };
  }, [folder?.id, uid, showRemote, tick]);

  function openMessage(next: number) {
    if (!folder) return;
    const path = `/mail/${folder.id}/${next}`;
    router.push(q ? `${path}?q=${encodeURIComponent(q)}` : path);
  }

  async function toggleStar(item: MessageSummary, event?: React.MouseEvent) {
    event?.stopPropagation();
    if (!folder) return;
    const flagged = !item.flagged;
    setPage((current) =>
      current
        ? { ...current, messages: current.messages.map((entry) => (entry.uid === item.uid ? { ...entry, flagged } : entry)) }
        : current,
    );
    if (message?.uid === item.uid) setMessage({ ...message, flagged });
    try {
      await api(`/api/mailboxes/${folder.id}/flags`, { method: "POST", json: { uids: [item.uid], flagged } });
    } catch (caught) {
      setPage((current) =>
        current
          ? { ...current, messages: current.messages.map((entry) => (entry.uid === item.uid ? { ...entry, flagged: item.flagged } : entry)) }
          : current,
      );
      if (message?.uid === item.uid) setMessage({ ...message, flagged: item.flagged });
      setError(caught instanceof Error ? caught.message : t("actionFailed"));
    }
  }

  async function moveTo(role: Mailbox["role"]) {
    if (!folder || !message) return;
    const destination = boxes.find((box) => box.role === role);
    if (!destination) return;
    try {
      await api(`/api/mailboxes/${folder.id}/move`, {
        method: "POST",
        json: { uids: [message.uid], destinationId: destination.id },
      });
      router.push(`/mail/${folder.id}`);
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("actionFailed"));
    }
  }

  async function removeMessage() {
    if (!folder || !message) return;
    try {
      await api(`/api/mailboxes/${folder.id}/delete`, { method: "POST", json: { uids: [message.uid] } });
      router.push(`/mail/${folder.id}`);
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("actionFailed"));
    }
  }

  async function markUnread() {
    if (!folder || !message) return;
    try {
      await api(`/api/mailboxes/${folder.id}/flags`, { method: "POST", json: { uids: [message.uid], seen: false } });
      router.push(`/mail/${folder.id}`);
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("actionFailed"));
    }
  }

  const messages = page?.messages || [];
  const start = messages.length ? offset + 1 : 0;
  const end = offset + messages.length;

  return (
    <div className="flex h-full min-h-0">
      <section className={cn("flex w-full min-w-0 flex-col border-r border-line bg-surface lg:w-[380px] lg:shrink-0", uid && "hidden lg:flex")}>
        <header className="flex h-12 items-center justify-between gap-3 px-4">
          <h1 className="text-sm font-semibold">{folder ? labelFor(folder, t) : t("inbox")}</h1>
          <div className="flex items-center gap-3">
            <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => reload()}>
              {t("refresh")}
            </button>
            {folder && (folder.role === "trash" || folder.role === "junk") && (
              <button
                type="button"
                className="text-xs text-muted hover:text-ink"
                onClick={() =>
                  void api(`/api/mailboxes/${folder.id}/empty`, { method: "POST" })
                    .then(() => reload())
                    .catch((caught) => setError(caught instanceof Error ? caught.message : t("actionFailed")))
                }
              >
                {folder.role === "trash" ? t("emptyTrash") : t("emptySpam")}
              </button>
            )}
            {folder && folder.role !== "trash" && folder.role !== "junk" && (
              <button
                type="button"
                className="text-xs text-muted hover:text-ink"
                onClick={() =>
                  void api(`/api/mailboxes/${folder.id}/read`, { method: "POST" })
                    .then(() => reload())
                    .catch((caught) => setError(caught instanceof Error ? caught.message : t("actionFailed")))
                }
              >
                {t("markAllRead")}
              </button>
            )}
          </div>
        </header>
        {error && page && (
          <p className="px-4 pb-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList && !page && <ListSkeleton />}
          {error && !page && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm">{t("couldNotLoad")}</p>
              <button type="button" className="mt-3 text-sm text-brand" onClick={() => void loadList()}>
                {t("retry")}
              </button>
            </div>
          )}
          {!loadingList && messages.length === 0 && (
            <p className="px-6 py-16 text-center text-sm text-muted">{q ? t("noSearch") : t("noMessages")}</p>
          )}
          <ul>
            {messages.map((item, index) => {
              const group = dayGroup(item.date, timeZone, language);
              const previous = index > 0 ? dayGroup(messages[index - 1].date, timeZone, language) : "";
              return (
                <li key={item.uid}>
                  {group !== previous && <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{group}</p>}
                  <div className={cn("flex w-full gap-1 border-b border-line pr-2", uid === item.uid ? "bg-mint" : "hover:bg-canvas")}>
                    <button type="button" onClick={() => openMessage(item.uid)} className="flex min-w-0 flex-1 gap-3 px-4 py-3 text-left">
                      <span
                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-brand"
                        style={{ background: toneFor(item.from[0]?.address || item.subject) }}
                      >
                        {initials(personLabel(item.from[0]), item.from[0]?.address || "?")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={cn("min-w-0 flex-1 truncate text-sm", !item.seen && "font-semibold")}>
                            {personLabel(item.from[0]) || t("you")}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted">{formatWhen(item.date, timeZone, language)}</span>
                        </span>
                        <span className={cn("mt-0.5 block truncate text-sm", !item.seen ? "text-ink" : "text-ink/80")}>
                          {item.subject || t("subject")}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                          <span className="truncate">{item.preview}</span>
                          {item.hasAttachments && <Paperclip className="h-3 w-3 shrink-0" />}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={item.flagged ? t("unstar") : t("star")}
                      onClick={() => void toggleStar(item)}
                      className="mt-3 h-8 w-8 shrink-0 text-muted"
                    >
                      <Star className={cn("mx-auto h-4 w-4", item.flagged && "fill-star text-star")} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {page?.capped && <p className="px-4 py-3 text-xs text-muted">{t("capped")}</p>}
        </div>
        {page && page.total > PAGE && (
          <footer className="flex h-12 items-center justify-between border-t border-line px-4 text-xs text-muted">
            <span>
              {start}–{end} {t("pageOf")} {page.total}
            </span>
            <span className="flex gap-3">
              <button type="button" disabled={offset === 0} className="disabled:opacity-40" onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {t("previous")}
              </button>
              <button type="button" disabled={end >= page.total} className="disabled:opacity-40" onClick={() => setOffset(offset + PAGE)}>
                {t("next")}
              </button>
            </span>
          </footer>
        )}
      </section>
      <section className={cn("min-w-0 flex-1 bg-canvas", !uid && "hidden lg:block")}>
        {!message && (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-sm font-medium">{t("selectMessage")}</p>
              <p className="mt-1 text-sm text-muted">{t("selectDetail")}</p>
            </div>
          </div>
        )}
        {message && folder && (
          <article className="flex h-full min-h-0 flex-col">
            <header className="flex items-center gap-1 border-b border-line bg-surface px-3 py-2">
              <button type="button" className="grid h-8 w-8 place-items-center rounded-md hover:bg-canvas lg:hidden" aria-label={t("back")} onClick={() => router.push(`/mail/${folder.id}`)}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <IconButton label={t("reply")} onClick={() => openCompose({ mode: "reply", folderId: folder.id, uid: message.uid })}>
                <Reply className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("replyAll")} onClick={() => openCompose({ mode: "replyAll", folderId: folder.id, uid: message.uid })}>
                <ReplyAll className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("forward")} onClick={() => openCompose({ mode: "forward", folderId: folder.id, uid: message.uid })}>
                <Forward className="h-4 w-4" />
              </IconButton>
              <span className="mx-1 h-4 w-px bg-line" />
              <IconButton label={t("archive")} onClick={() => void moveTo("archive")}>
                <Archive className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("spam")} onClick={() => void moveTo("junk")}>
                <ShieldAlert className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("remove")} onClick={() => void removeMessage()}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
              <IconButton label={message.flagged ? t("unstar") : t("star")} onClick={() => void toggleStar(message)}>
                <Star className={cn("h-4 w-4", message.flagged && "fill-star text-star")} />
              </IconButton>
              <button type="button" className="ml-auto text-xs text-muted" onClick={() => void markUnread()}>
                {t("markUnread")}
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
              <h2 className="text-[26px] font-semibold tracking-[-0.03em]">{message.subject || `(${t("subject")})`}</h2>
              <div className="mt-4 flex items-start gap-3">
                <span
                  className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-brand"
                  style={{ background: toneFor(message.from[0]?.address || "") }}
                >
                  {initials(personLabel(message.from[0]), message.from[0]?.address || "?")}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{personLabel(message.from[0])}</p>
                  <p className="text-muted">{message.from[0]?.address}</p>
                  <p className="mt-1 text-muted">
                    {t("to")} {message.to.map((item) => item.name || item.address).join(", ") || user?.email}
                  </p>
                </div>
                <time className="ml-auto shrink-0 text-xs text-muted">{formatFull(message.date, timeZone, language)}</time>
              </div>
              {message.remoteImagesBlocked && (
                <button type="button" onClick={() => setShowRemote(true)} className="mt-4 rounded-lg bg-mint px-3 py-2 text-sm text-brand">
                  {t("imagesHidden")} {t("showImages")}
                </button>
              )}
              {message.attachments.some((item) => !item.inline) && (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {message.attachments.filter((item) => !item.inline).map((item) => (
                    <li key={item.partId}>
                      <a
                        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                        href={`/api/mailboxes/${folder.id}/messages/${message.uid}/attachments/${item.partId}`}
                      >
                        <Paperclip className="h-3.5 w-3.5 text-muted" />
                        {item.filename}
                        <span className="text-xs text-muted">{formatBytes(item.size)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <button type="button" className="text-xs text-muted" onClick={() => setView(view === "html" ? "plain" : "html")}>
                  {view === "html" ? t("plain") : t("html")}
                </button>
              </div>
              {view === "plain" ? (
                <pre className="mt-3 whitespace-pre-wrap font-sans text-[15px] leading-7">{message.text}</pre>
              ) : (
                <iframe
                  title={message.subject || t("html")}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  className="mt-3 h-[min(70vh,760px)] w-full bg-transparent"
                  srcDoc={emailDocument(message.html)}
                />
              )}
            </div>
          </article>
        )}
      </section>
      <ComposeModal onSent={() => reload()} />
    </div>
  );
}

function labelFor(box: Mailbox, t: (key: "inbox" | "drafts" | "sent" | "spam" | "trash" | "archive") => string) {
  if (box.role === "inbox") return t("inbox");
  if (box.role === "drafts") return t("drafts");
  if (box.role === "sent") return t("sent");
  if (box.role === "junk") return t("spam");
  if (box.role === "trash") return t("trash");
  if (box.role === "archive") return t("archive");
  return box.name;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-md text-ink hover:bg-canvas">
      {children}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-px px-4 py-3">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex gap-3 py-3">
          <div className="h-8 w-8 rounded-full bg-canvas" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-canvas" />
            <div className="h-3 w-2/3 rounded bg-canvas" />
          </div>
        </div>
      ))}
    </div>
  );
}

function emailDocument(html: string) {
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; form-action 'none';"><base target="_blank"><style>body{margin:0;font:15px/1.65 Outfit,Georgia,serif;color:#18211c;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#123C32}blockquote{margin:.6em 0;padding-left:.8em;border-left:2px solid #d5e0da;color:#4d5d56}pre{white-space:pre-wrap}</style></head><body>${clean}</body></html>`;
}
