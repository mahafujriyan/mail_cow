"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  FileText,
  Inbox,
  Menu,
  Pencil,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Mark } from "@/components/brand";
import { api } from "@/lib/api";
import { useCompose } from "@/lib/compose";
import { useI18n, type DictionaryKey } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Mailbox } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

const ROLE_ORDER = ["inbox", "drafts", "sent", "junk", "trash", "archive"] as const;

const ROLE_KEY: Record<(typeof ROLE_ORDER)[number], DictionaryKey> = {
  inbox: "inbox",
  drafts: "drafts",
  sent: "sent",
  junk: "spam",
  trash: "trash",
  archive: "archive",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mail = pathname.startsWith("/mail");
  const { user } = useSession();
  const { t } = useI18n();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <TopBar onMenu={() => setNavOpen(true)} />
      {user?.demo && (
        <div className="border-b border-line bg-mint px-4 py-1.5 text-center text-xs text-brand">{t("demo")}</div>
      )}
      <div className="flex min-h-0 flex-1">
        {mail && (
          <>
            <div className="hidden w-[232px] shrink-0 border-r border-line bg-surface md:block">
              <FolderNav />
            </div>
            {navOpen && (
              <div className="fixed inset-0 z-40 md:hidden">
                <button className="absolute inset-0 bg-[#121614]/30" aria-label={t("close")} onClick={() => setNavOpen(false)} />
                <div className="absolute inset-y-0 left-0 w-[260px] bg-surface shadow-sheet">
                  <FolderNav onNavigate={() => setNavOpen(false)} />
                </div>
              </div>
            )}
          </>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { t } = useI18n();
  const { user, setUser } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");

  useEffect(() => {
    setQuery(params.get("q") || "");
  }, [params]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.replace("/login");
  }

  const folder = pathname.startsWith("/mail/") ? pathname.split("/")[2] : "";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 md:px-4">
      <button type="button" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-canvas md:hidden" aria-label={t("menu")} onClick={onMenu}>
        <Menu className="h-4 w-4" />
      </button>
      <Link href="/mail" className="flex items-center gap-2.5">
        <Mark />
        <span className="text-[15px] font-semibold tracking-[-0.03em]">{t("product")}</span>
      </Link>
      <form
        className="relative mx-auto w-full max-w-[280px] sm:max-w-[420px]"
        onSubmit={(event) => {
          event.preventDefault();
          const next = query.trim();
          const path = folder ? `/mail/${folder}` : "/mail";
          router.push(next ? `${path}?q=${encodeURIComponent(next)}` : path);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchMail")}
          aria-label={t("searchMail")}
          className="h-9 w-full rounded-full border border-transparent bg-canvas pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-line focus:bg-surface"
        />
      </form>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t("account")}
          className="ml-auto grid h-8 w-8 place-items-center rounded-full bg-mint text-xs font-semibold text-brand"
        >
          {initials(user?.settings.displayName || "", user?.email || "S")}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-56 rounded-xl border border-line bg-surface p-1 text-sm shadow-sheet">
            <div className="px-3 py-2 text-xs text-muted">{user?.email}</div>
            <MenuLink href="/settings">{t("settings")}</MenuLink>
            <MenuLink href="/contacts">{t("contacts")}</MenuLink>
            <DropdownMenu.Item className="cursor-pointer rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-canvas" onSelect={() => void logout()}>
              {t("logOut")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <DropdownMenu.Item asChild className="cursor-pointer rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-canvas">
      <Link href={href}>{children}</Link>
    </DropdownMenu.Item>
  );
}

export function FolderNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { openCompose } = useCompose();
  const pathname = usePathname();
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const router = useRouter();

  async function load() {
    const data = await api<{ mailboxes: Mailbox[] }>("/api/mailboxes");
    setBoxes(data.mailboxes);
  }

  useEffect(() => {
    void load().catch(() => setBoxes([]));
  }, [pathname]);

  const special = ROLE_ORDER.map((role) => boxes.find((box) => box.role === role)).filter((box): box is Mailbox => Boolean(box));
  const custom = boxes.filter((box) => box.role === "custom");
  const current = pathname.split("/")[2] || "";

  async function createFolder(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const created = await api<{ id: string }>("/api/mailboxes", { method: "POST", json: { name: name.trim() } });
    setName("");
    setCreating(false);
    await load();
    router.push(`/mail/${created.id}`);
    onNavigate?.();
  }

  return (
    <nav className="flex h-full flex-col py-3">
      <button
        type="button"
        onClick={() => {
          openCompose({ mode: "new" });
          onNavigate?.();
        }}
        className="mx-3 flex h-10 items-center justify-center gap-2 rounded-full bg-brand text-sm font-semibold text-on-brand hover:bg-[#0e3329]"
      >
        <Pencil className="h-4 w-4" />
        {t("compose")}
      </button>
      <div className="mt-3 flex-1 overflow-y-auto px-2">
        {special.map((box) => (
          <FolderLink key={box.id} box={box} label={t(ROLE_KEY[box.role as keyof typeof ROLE_KEY])} active={current === box.id} onNavigate={onNavigate} />
        ))}
        {(custom.length > 0 || creating) && <div className="mx-2 my-2 border-t border-line" />}
        {custom.map((box) => (
          <FolderLink key={box.id} box={box} label={box.name} active={current === box.id} onNavigate={onNavigate} />
        ))}
        {creating ? (
          <form onSubmit={createFolder} className="mt-1 flex items-center gap-1 px-2">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("folderName")}
              className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-sm outline-none"
            />
            <button type="submit" className="text-xs font-medium text-brand">{t("add")}</button>
            <button type="button" aria-label={t("cancel")} onClick={() => setCreating(false)}>
              <X className="h-3.5 w-3.5 text-muted" />
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-sm text-muted hover:bg-canvas hover:text-ink">
            {t("newFolder")}
          </button>
        )}
      </div>
    </nav>
  );
}

function FolderLink({ box, label, active, onNavigate }: { box: Mailbox; label: string; active: boolean; onNavigate?: () => void }) {
  const count = box.role === "drafts" ? box.total : box.unseen;
  const Icon = iconFor(box.role);
  return (
    <Link
      href={`/mail/${box.id}`}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm",
        active ? "bg-mint font-medium text-brand" : "text-ink hover:bg-canvas",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="text-xs tabular-nums text-muted">{count}</span>}
    </Link>
  );
}

function iconFor(role: Mailbox["role"]) {
  if (role === "inbox") return Inbox;
  if (role === "drafts") return FileText;
  if (role === "sent") return Send;
  if (role === "junk") return ShieldAlert;
  if (role === "trash") return Trash2;
  if (role === "archive") return Archive;
  return FileText;
}
