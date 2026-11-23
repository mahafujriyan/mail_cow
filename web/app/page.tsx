<<<<<<< HEAD
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/mail");
=======
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ArrowLeft, ArrowUpRight, Bell, Check, ChevronDown, ChevronLeft, ChevronRight,
  File, FileImage, Flag, Inbox, LoaderCircle, LogOut, Mail, MailOpen, Menu, MoreHorizontal,
  Paperclip, PenLine, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Star, Trash2,
  Users, X,
} from "lucide-react";
import { api, ApiError, setCsrf, uploadFile } from "@/lib/api";
import type { Attachment, Mailbox, MessageDetail, MessagePage, MessageSummary, SessionUser, UploadResult } from "@/lib/types";
import { formatBytes, personLabel } from "@/lib/utils";
import { formatFull, formatWhen } from "@/lib/format";

type AuthResult = SessionUser & { csrfToken: string };
type MailboxResult = { mailboxes: Mailbox[] };
type SendPayload = {
  to: { name: string; address: string }[];
  cc: { name: string; address: string }[];
  bcc: { name: string; address: string }[];
  subject: string;
  html: string;
  attachmentIds: string[];
};
const roleLabels: Record<string, string> = {
  inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive",
  junk: "Spam", trash: "Trash", custom: "Folders",
};
const roleIcons: Record<string, typeof Inbox> = {
  inbox: Inbox, sent: Send, drafts: PenLine, archive: Archive, junk: ShieldCheck, trash: Trash2, custom: Mail,
};

function getError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
function addressList(value: string) {
  return value.split(/[;,]/).map((part) => part.trim()).filter(Boolean).map((address) => ({ name: "", address }));
}
function safeInitial(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}

export default function HomePage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [activeBox, setActiveBox] = useState<Mailbox | null>(null);
  const [page, setPage] = useState<MessagePage | null>(null);
  const [selected, setSelected] = useState<MessageSummary | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");

  const loadMailboxes = useCallback(async () => {
    const result = await api<MailboxResult>("/api/mailboxes");
    setMailboxes(result.mailboxes.filter((box) => box.selectable));
    setActiveBox((current) => current ? result.mailboxes.find((box) => box.id === current.id) || result.mailboxes.find((box) => box.role === "inbox") || null : result.mailboxes.find((box) => box.role === "inbox") || result.mailboxes[0] || null);
  }, []);

  const loadMessages = useCallback(async (box: Mailbox, nextOffset = 0, nextFilter = filter, nextQuery = query) => {
    setLoadingList(true);
    setError("");
    setSelected(null);
    setDetail(null);
    try {
      const params = new URLSearchParams({ offset: String(nextOffset), limit: "40", filter: nextFilter, q: nextQuery });
      const result = await api<MessagePage>(`/api/mailboxes/${encodeURIComponent(box.id)}/messages?${params}`);
      setPage(result);
      setOffset(nextOffset);
    } catch (e) {
      setError(getError(e));
    } finally {
      setLoadingList(false);
    }
  }, [filter, query]);

  const loadDetail = useCallback(async (message: MessageSummary, box = activeBox) => {
    if (!box) return;
    setSelected(message);
    setLoadingDetail(true);
    setError("");
    try {
      const result = await api<MessageDetail>(`/api/mailboxes/${encodeURIComponent(box.id)}/messages/${message.uid}`);
      setDetail(result);
      setPage((current) => current ? { ...current, messages: current.messages.map((item) => item.uid === message.uid ? { ...item, seen: true } : item) } : current);
      setMailboxes((current) => current.map((item) => item.id === box.id ? { ...item, unseen: Math.max(0, item.unseen - (message.seen ? 0 : 1)) } : item));
    } catch (e) {
      setError(getError(e));
    } finally {
      setLoadingDetail(false);
    }
  }, [activeBox]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const csrf = await api<{ csrfToken: string }>("/api/auth/csrf");
        if (csrf.csrfToken) setCsrf(csrf.csrfToken);
        const me = await api<SessionUser>("/api/auth/me");
        if (!alive) return;
        setUser(me);
      } catch {
        // A 401 here simply means the visitor needs to sign in.
      } finally {
        if (alive) setBooting(false);
      }
    })();
    const onUnauthorized = () => { setUser(null); setPage(null); setDetail(null); };
    window.addEventListener("sbr-unauthorized", onUnauthorized);
    return () => { alive = false; window.removeEventListener("sbr-unauthorized", onUnauthorized); };
  }, []);

  useEffect(() => {
    if (!user) return;
    loadMailboxes().catch((e) => setError(getError(e)));
  }, [user, loadMailboxes]);

  useEffect(() => {
    if (!user || !activeBox) return;
    loadMessages(activeBox, 0, filter, query);
  }, [user, activeBox?.id, filter, query, loadMessages]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true); setAuthError("");
    try {
      const result = await api<AuthResult>("/api/auth/login", { method: "POST", json: { email, password } });
      if (result.csrfToken) setCsrf(result.csrfToken);
      setUser({ email: result.email, demo: result.demo, settings: result.settings });
      setPassword("");
    } catch (e) {
      setAuthError(getError(e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* clear local state regardless */ }
    setUser(null); setMailboxes([]); setPage(null); setDetail(null); setActiveBox(null);
  }

  function chooseBox(box: Mailbox) {
    setActiveBox(box); setMobileNav(false); setOffset(0); setSelected(null); setDetail(null);
  }

  async function refresh() {
    if (!activeBox) return;
    await loadMailboxes();
    await loadMessages(activeBox, offset, filter, query);
  }

  async function toggleStar(message: MessageSummary) {
    if (!activeBox) return;
    try {
      await api(`/api/mailboxes/${encodeURIComponent(activeBox.id)}/flags`, { method: "POST", json: { uids: [message.uid], flagged: !message.flagged } });
      setPage((current) => current ? { ...current, messages: current.messages.map((item) => item.uid === message.uid ? { ...item, flagged: !item.flagged } : item) } : current);
      if (detail?.uid === message.uid) setDetail({ ...detail, flagged: !detail.flagged });
    } catch (e) { setError(getError(e)); }
  }

  async function markUnread(message: MessageSummary) {
    if (!activeBox) return;
    try {
      await api(`/api/mailboxes/${encodeURIComponent(activeBox.id)}/flags`, { method: "POST", json: { uids: [message.uid], seen: false } });
      setPage((current) => current ? { ...current, messages: current.messages.map((item) => item.uid === message.uid ? { ...item, seen: false } : item) } : current);
      setDetail(null); setSelected(null);
      setNotice("Marked as unread");
    } catch (e) { setError(getError(e)); }
  }

  async function deleteMessage(message: MessageSummary) {
    if (!activeBox || !window.confirm("Move this message to Trash?")) return;
    try {
      await api(`/api/mailboxes/${encodeURIComponent(activeBox.id)}/delete`, { method: "POST", json: { uids: [message.uid] } });
      setDetail(null); setSelected(null);
      await loadMessages(activeBox, offset);
      await loadMailboxes();
      setNotice("Message moved to Trash");
    } catch (e) { setError(getError(e)); }
  }

  function openCompose() {
    setTo(""); setCc(""); setBcc(""); setSubject(""); setBody(""); setUploads([]);
    setComposeOpen(true);
  }

  async function attachFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadFile(file);
        setUploads((current) => [...current, uploaded]);
      }
    } catch (e) { setError(getError(e)); }
    finally { setUploading(false); }
  }

  async function removeUpload(id: string) {
    try { await api(`/api/uploads/${id}`, { method: "DELETE" }); } catch { /* stale upload cleanup is handled server-side */ }
    setUploads((current) => current.filter((item) => item.id !== id));
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!to.trim()) { setError("Add at least one recipient."); return; }
    setSending(true); setError("");
    const plain = body.split("\n").map((line) => line ? `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : "<p><br></p>").join("");
    const payload: SendPayload = { to: addressList(to), cc: addressList(cc), bcc: addressList(bcc), subject, html: plain, attachmentIds: uploads.map((item) => item.id) };
    try {
      await api("/api/messages/send", { method: "POST", json: payload });
      setComposeOpen(false); setUploads([]); setNotice("Message sent");
      const sentBox = mailboxes.find((box) => box.role === "sent");
      if (sentBox) chooseBox(sentBox);
    } catch (e) { setError(getError(e)); }
    finally { setSending(false); }
  }

  async function replyToMessage() {
    if (!detail || !activeBox) return;
    const from = detail.from[0];
    setTo(from?.address || "");
    setSubject(detail.subject.toLowerCase().startsWith("re:") ? detail.subject : `Re: ${detail.subject}`);
    setBody("");
    setCc("");
    setBcc("");
    setUploads([]);
    setComposeOpen(true);
  }

  const unreadTotal = useMemo(() => mailboxes.reduce((sum, box) => sum + box.unseen, 0), [mailboxes]);
  const currentPage = page ? Math.floor(page.offset / page.limit) + 1 : 1;
  const pageCount = page ? Math.max(1, Math.ceil(page.total / page.limit)) : 1;

  if (booting) return <div className="boot-screen"><div className="brand-mark"><Mail size={23} /></div><LoaderCircle className="spin" size={22} /><span>Preparing your mailbox…</span></div>;

  if (!user) return (
    <main className="login-screen">
      <div className="login-ambient ambient-one" /><div className="login-ambient ambient-two" />
      <section className="login-card">
        <div className="brand-lockup"><div className="brand-mark"><Mail size={23} /></div><div><strong>blackrock<span>mail</span></strong><small>SECURITY BLACKROCK</small></div></div>
        <div className="login-intro"><div className="eyebrow"><ShieldCheck size={14} /> PRIVATE MAIL, BUILT FOR YOU</div><h1>Your inbox,<br /><em>in good hands.</em></h1><p>Sign in with your mailbox address to access your secure workspace.</p></div>
        <form className="login-form" onSubmit={handleLogin}>
          <label>Email address<input type="email" autoComplete="username" placeholder="you@securityblackrock.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" placeholder="Your mailbox password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {authError && <div className="form-error">{authError}</div>}
          <button className="primary-button login-submit" disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={18} /> : <span>Sign in securely</span>}<ArrowUpRight size={18} /></button>
        </form>
        <div className="login-foot"><span><span className="status-dot" /> Secure IMAP connection</span><span>Protected workspace</span></div>
      </section>
      <footer className="login-footer">© {new Date().getFullYear()} Security Blackrock <span>·</span> Private communication</footer>
    </main>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand"><button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation"><Menu size={20} /></button><div className="brand-mark small"><Mail size={18} /></div><strong>blackrock<span>mail</span></strong></div>
        <div className="topbar-search"><Search size={17} /><input aria-label="Search mail" placeholder="Search messages…" value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>↵</kbd></div>
        <div className="topbar-actions"><span className="secure-label"><ShieldCheck size={15} /> Secure session</span><button className="icon-button" title="Refresh inbox" onClick={refresh}><RefreshCw size={18} /></button><div className="avatar">{safeInitial(user.email)}</div><div className="user-address">{user.email}<small>Mailbox account</small></div><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={18} /></button></div>
      </header>
      <div className="workspace">
        <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
          <button className="compose-button" onClick={openCompose}><PenLine size={17} /> Compose <Plus size={17} /></button>
          <div className="nav-caption">MAILBOX</div>
          <nav className="folder-nav">
            {mailboxes.map((box) => {
              const Icon = roleIcons[box.role] || Mail;
              return <button key={box.id} className={`folder-link ${activeBox?.id === box.id ? "active" : ""}`} onClick={() => chooseBox(box)}><Icon size={17} /><span>{box.name || roleLabels[box.role]}</span>{box.unseen > 0 && <b>{box.unseen}</b>}</button>;
            })}
          </nav>
          <div className="sidebar-bottom"><div className="storage-card"><div className="storage-icon"><ShieldCheck size={17} /></div><div><strong>Connection protected</strong><span>Encrypted mail transport</span></div><span className="status-dot" /></div><button className="folder-link muted-link" onClick={logout}><Settings size={17} /><span>Account & sign out</span></button></div>
        </aside>
        {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
        <section className="mail-area">
          <div className="mail-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>{activeBox?.name || "Inbox"}<span>{page?.total ?? 0}</span></h1><p>{activeBox?.unseen ?? unreadTotal} unread messages in this folder</p></div><div className="heading-actions"><button className="icon-button" title="Refresh" onClick={refresh}><RefreshCw size={17} /></button><button className="filter-button" onClick={() => setFilter(filter === "unread" ? "all" : "unread")}>{filter === "unread" ? "Unread" : "All mail"} <ChevronDown size={15} /></button></div></div>
          <div className="mail-toolbar"><div className="filter-tabs">{["all", "unread", "starred", "attachments"].map((value) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "unread" ? "Unread" : value === "starred" ? "Starred" : "Attachments"}</button>)}</div><div className="list-count">{page?.total ? `${offset + 1}–${Math.min(offset + (page?.messages.length || 0), page.total)} of ${page.total}` : "No messages"}</div></div>
          {error && <div className="inline-error"><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
          {notice && <div className="inline-notice"><Check size={15} /><span>{notice}</span><button onClick={() => setNotice("")}><X size={15} /></button></div>}
          <div className={`content-grid ${detail ? "detail-open" : ""}`}>
            <section className="message-list">
              {loadingList ? <div className="list-loading"><LoaderCircle className="spin" /> Loading messages…</div> : page?.messages.length ? page.messages.map((message) => {
                const sender = message.from[0];
                return <article key={message.uid} className={`message-row ${!message.seen ? "unread" : ""} ${selected?.uid === message.uid ? "chosen" : ""}`}>
                  <button className="message-main" onClick={() => loadDetail(message)}><span className="sender-avatar">{safeInitial(sender?.name || sender?.address || "?")}</span><span className="message-copy"><strong>{sender?.name || sender?.address || "Unknown sender"}</strong><span className="message-subject">{message.subject || "(No subject)"}</span><span className="message-preview">{message.preview || "Open message to view its contents"}</span></span><span className="message-meta">{message.hasAttachments && <Paperclip size={14} />}<time>{formatWhen(message.date, user.settings.timeZone || "Asia/Dhaka", user.settings.language)}</time></span></button>
                  <button className={`star-button ${message.flagged ? "starred" : ""}`} title={message.flagged ? "Remove star" : "Star message"} onClick={() => toggleStar(message)}><Star size={16} fill={message.flagged ? "currentColor" : "none"} /></button>
                </article>;
              }) : <div className="empty-state"><div className="empty-icon"><Inbox size={24} /></div><strong>{query ? "No matching messages" : "All caught up"}</strong><p>{query ? "Try another search term or clear your search." : "There are no messages to show in this folder."}</p><button className="text-button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button></div>}
              {page && page.total > page.limit && <div className="pagination"><span>Page {currentPage} of {pageCount}</span><div><button className="icon-button" disabled={offset === 0} onClick={() => activeBox && loadMessages(activeBox, Math.max(0, offset - 40))}><ChevronLeft size={17} /></button><button className="icon-button" disabled={offset + 40 >= page.total} onClick={() => activeBox && loadMessages(activeBox, offset + 40)}><ChevronRight size={17} /></button></div></div>}
            </section>
            <section className="reading-pane">
              {!selected ? <div className="reading-empty"><div className="reading-art"><MailOpen size={31} /></div><strong>Your messages, at a glance</strong><p>Select an email to read it here.</p><div className="shortcut-hint"><span>TIP</span> Use search to find a message quickly</div></div> : loadingDetail ? <div className="list-loading"><LoaderCircle className="spin" /> Opening message…</div> : detail ? <div className="message-detail">
                <div className="detail-toolbar"><button className="icon-button" title="Back to messages" onClick={() => { setSelected(null); setDetail(null); }}><ArrowLeft size={17} /></button><div className="detail-actions"><button className="icon-button" title="Mark unread" onClick={() => markUnread(detail)}><Mail size={17} /></button><button className="icon-button" title="Move to trash" onClick={() => deleteMessage(detail)}><Trash2 size={17} /></button><button className={`icon-button ${detail.flagged ? "is-starred" : ""}`} title="Star" onClick={() => toggleStar(detail)}><Star size={17} /></button></div></div>
                <h2>{detail.subject || "(No subject)"}</h2>
                <div className="detail-sender"><div className="sender-avatar large">{safeInitial(detail.from[0]?.name || detail.from[0]?.address || "?")}</div><div><strong>{detail.from[0]?.name || detail.from[0]?.address}</strong><span>{detail.from[0]?.address}</span><small>To: {detail.to.map((item) => item.address).join(", ") || user.email}</small></div><time>{formatFull(detail.date, user.settings.timeZone || "Asia/Dhaka", user.settings.language)}</time></div>
                {detail.attachments?.length > 0 && <div className="attachment-strip">{detail.attachments.map((file: Attachment) => <a key={file.partId} href={`/api/mailboxes/${encodeURIComponent(activeBox!.id)}/messages/${detail.uid}/attachments/${encodeURIComponent(file.partId)}`} target="_blank" rel="noreferrer"><File size={16} /><span>{file.filename}<small>{formatBytes(file.size)}</small></span><ArrowUpRight size={14} /></a>)}</div>}
                <div className="email-body" dangerouslySetInnerHTML={{ __html: detail.html || `<p>${(detail.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>` }} />
                <div className="reply-actions"><button className="primary-button" onClick={replyToMessage}><ArrowUpRight size={16} /> Reply</button><button className="secondary-button" onClick={() => { setTo(detail.from[0]?.address || ""); setSubject(`Fwd: ${detail.subject}`); setBody(""); setComposeOpen(true); }}>Forward</button></div>
              </div> : null}
            </section>
          </div>
          <footer className="workspace-footer"><span><span className="status-dot" /> Connected to mail server</span><span>Security Blackrock Mail <b>·</b> {unreadTotal} unread</span></footer>
        </section>
      </div>
      {composeOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setComposeOpen(false); }}><form className="compose-window" onSubmit={sendMessage}>
        <header><div><PenLine size={17} /><strong>New message</strong></div><button type="button" className="icon-button" onClick={() => setComposeOpen(false)}><X size={18} /></button></header>
        <label className="compose-field"><span>To</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com (separate multiple with commas)" type="text" required /></label>
        <label className="compose-field"><span>Cc</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" /></label>
        <label className="compose-field"><span>Bcc</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Optional" /></label>
        <label className="compose-field"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Add a subject" /></label>
        <textarea className="compose-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />
        {uploads.length > 0 && <div className="upload-list">{uploads.map((file) => <div key={file.id}><FileImage size={15} /><span>{file.name} <small>{formatBytes(file.size)}</small></span><button type="button" onClick={() => removeUpload(file.id)}><X size={14} /></button></div>)}</div>}
        <footer><div className="compose-tools"><label className="attach-button"><Paperclip size={17} /> Attach files<input type="file" multiple onChange={(e) => { void attachFiles(e.target.files); e.currentTarget.value = ""; }} /></label>{uploading && <span className="uploading"><LoaderCircle className="spin" size={14} /> Uploading…</span>}<span className="compose-hint">Up to 25 MB per file</span></div><button className="primary-button send-button" disabled={sending || uploading}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} Send message</button></footer>
      </form></div>}
    </main>
  );
>>>>>>> 5c00b5ac3a83bac3d4450112924e16bc7192fc80
}
