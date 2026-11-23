"use client";

import DOMPurify from "dompurify";
import Link from "next/link";
import { useMemo, useState } from "react";
import { MailEditor } from "@/components/editor";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useI18n, type Language } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Settings } from "@/lib/types";
import { initials } from "@/lib/utils";

export function SettingsScreen() {
  const { user, updateSettings } = useSession();
  const { t } = useI18n();
  const [form, setForm] = useState<Settings | null>(user?.settings || null);
  const [saved, setSaved] = useState("");

  if (!user || !form) return null;

  function patch(partial: Partial<Settings>) {
    setForm((current) => (current ? { ...current, ...partial } : current));
    setSaved("");
  }

  async function save(next: Settings, which: string) {
    const stored = await api<Settings>("/api/settings", { method: "PUT", json: next });
    setForm(stored);
    updateSettings(stored);
    setSaved(which);
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <p className="text-sm text-muted">
        <Link href="/mail" className="hover:text-ink">{t("mail")}</Link>
        <span className="px-1.5">/</span>
        <span className="text-ink">{t("settings")}</span>
      </p>
      <div className="mt-5 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title={t("profile")} detail={t("profileDetail")}>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-mint text-sm font-semibold text-brand">
              {initials(form.displayName, user.email)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{form.displayName || user.email}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
          <label className="mt-4 block text-xs text-muted" htmlFor="display-name">{t("displayName")}</label>
          <input
            id="display-name"
            value={form.displayName}
            onChange={(event) => patch({ displayName: event.target.value })}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
          />
          <p className="mt-3 text-xs text-muted">{t("emailAddress")}</p>
          <p className="mt-1 text-sm">{user.email}</p>
          <SaveRow saved={saved === "profile"} onClick={() => void save(form, "profile")} />
        </Card>

        <Card title={t("systemPreferences")} detail={t("systemDetail")}>
          <label className="block text-xs text-muted" htmlFor="language">{t("language")}</label>
          <select
            id="language"
            value={form.language}
            onChange={(event) => patch({ language: event.target.value as Language })}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none"
          >
            <option value="en">{t("english")}</option>
            <option value="es">{t("spanish")}</option>
          </select>
          <p className="mt-4 text-xs text-muted">{t("appearance")}</p>
          <div className="mt-2 inline-flex rounded-full bg-canvas p-1">
            <Segment active={form.theme === "light"} onClick={() => { patch({ theme: "light" }); document.documentElement.classList.remove("dark"); }}>{t("light")}</Segment>
            <Segment active={form.theme === "dark"} onClick={() => { patch({ theme: "dark" }); document.documentElement.classList.add("dark"); }}>{t("dark")}</Segment>
          </div>
          <SaveRow saved={saved === "preferences"} onClick={() => void save(form, "preferences")} />
        </Card>

        <Card title={t("signature")} detail={t("signatureDetail")}>
          <div className="overflow-hidden rounded-lg border border-line">
            <MailEditor
              seed={form.signatureHtml || "<p></p>"}
              seedKey="signature"
              placeholder={t("signaturePlaceholder")}
              minHeight={96}
              onChange={(html) => patch({ signatureHtml: html })}
            />
          </div>
          <SaveRow saved={saved === "signature"} onClick={() => void save({ ...form, signatureHtml: DOMPurify.sanitize(form.signatureHtml) }, "signature")} />
        </Card>

        <Card title={t("notifications")} detail={t("notificationsDetail")}>
          <Toggle
            label={t("desktopAlerts")}
            checked={form.notifyDesktop}
            onChange={(checked) => {
              patch({ notifyDesktop: checked });
              if (checked && typeof Notification !== "undefined" && Notification.permission === "default") {
                void Notification.requestPermission();
              }
            }}
          />
          <Toggle label={t("sound")} checked={form.notifySound} onChange={(checked) => patch({ notifySound: checked })} />
          <SaveRow saved={saved === "notifications"} onClick={() => void save(form, "notifications")} />
        </Card>

        <Card title={t("timeZone")} detail={t("timeZoneDetail")}>
          <TimeZoneSelect value={form.timeZone} onChange={(timeZone) => patch({ timeZone })} />
          <SaveRow saved={saved === "zone"} onClick={() => void save(form, "zone")} />
        </Card>
      </div>
    </div>
  );
}

function Card({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-muted">{detail}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={active ? "rounded-full bg-surface px-3 py-1 text-sm font-medium shadow-sm" : "rounded-full px-3 py-1 text-sm text-muted"}
    >
      {children}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="mt-3 flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function SaveRow({ saved, onClick }: { saved: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 flex items-center gap-3">
      <button type="button" onClick={onClick} className="h-9 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand">
        {t("save")}
      </button>
      {saved && <span className="text-sm text-muted">{t("saved")}</span>}
    </div>
  );
}

function TimeZoneSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const zones = useMemo(() => {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
    const pinned = ["Asia/Dhaka", "UTC", "America/New_York", "Europe/London"];
    return [...pinned.filter((zone) => supported.includes(zone)), ...supported.filter((zone) => !pinned.includes(zone))];
  }, []);
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none">
      {zones.map((zone) => (
        <option key={zone} value={zone}>{zone}</option>
      ))}
    </select>
  );
}
