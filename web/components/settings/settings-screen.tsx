"use client";

import DOMPurify from "dompurify";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MailEditor } from "@/components/editor";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useI18n, type Language } from "@/lib/i18n";
import { applyTheme, useSession } from "@/lib/session";
import type { Settings } from "@/lib/types";
import { avatarSrc, initials } from "@/lib/utils";

const PROFILE_KEYS = ["displayName", "avatarData"] as const;
const MAIL_KEYS = ["signatureHtml", "language", "timeZone"] as const;
const APPEARANCE_KEYS = ["theme"] as const;
const NOTIFY_KEYS = ["notifyDesktop", "notifySound"] as const;

export function SettingsScreen() {
  const { user, setUser, updateSettings } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<Settings | null>(null);
  const [baseline, setBaseline] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [editorEpoch, setEditorEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void api<Settings>("/api/settings")
      .then((data) => {
        if (cancelled) return;
        const next = normalize(data);
        setForm(next);
        setBaseline(next);
        setLoading(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setLoadError(caught instanceof ApiError ? caught.message : t("settingsLoadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const dirty = Boolean(form && baseline && snapshot(form) !== snapshot(baseline));

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (window.confirm(t("unsavedConfirm"))) {
        if (baseline) applyTheme(baseline.theme);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [baseline, dirty, t]);

  function patch(partial: Partial<Settings>) {
    setForm((current) => (current ? { ...current, ...partial } : current));
    setSaved("");
    setError("");
  }

  function changed(keys: readonly (keyof Settings)[]) {
    if (!form || !baseline) return false;
    return keys.some((key) => form[key] !== baseline[key]);
  }

  async function save(which: string) {
    if (!form || saving) return;
    setSaving(which);
    setError("");
    try {
      const stored = await api<Settings>("/api/settings", {
        method: "PUT",
        json: {
          displayName: form.displayName,
          signatureHtml: DOMPurify.sanitize(form.signatureHtml),
          language: form.language,
          timeZone: form.timeZone,
          theme: form.theme,
          notifyDesktop: form.notifyDesktop,
          notifySound: form.notifySound,
          avatarData: form.avatarData,
        },
      });
      const next = normalize(stored);
      setForm(next);
      setBaseline(next);
      updateSettings(next);
      applyTheme(next.theme);
      setSaved(which);
      setEditorEpoch((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("saveFailed"));
    } finally {
      setSaving("");
    }
  }

  async function signOut() {
    if (dirty && !window.confirm(t("unsavedConfirm"))) return;
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("actionFailed"));
      return;
    }
    setUser(null);
    router.replace("/login");
  }

  function onAvatar(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 200 * 1024) {
      setError(t("avatarHint"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!avatarSrc(value)) {
        setError(t("avatarHint"));
        return;
      }
      patch({ avatarData: value });
    };
    reader.readAsDataURL(file);
  }

  if (!user) return null;

  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[720px]">
        <p className="text-sm text-muted">
          <Link href="/mail" className="hover:text-ink">
            {t("mail")}
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-ink">{t("settings")}</span>
        </p>
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <h1 className="text-[28px] font-semibold tracking-[-0.04em]">{t("settings")}</h1>
          {dirty && (
            <p className="text-sm text-muted" role="status">
              {t("unsaved")}
            </p>
          )}
        </div>
        {loading && !form && (
          <p className="mt-8 text-sm text-muted" role="status">
            {t("loading")}
          </p>
        )}
        {loadError && !form && (
          <div className="mt-8">
            <p className="text-sm">{loadError}</p>
            <button type="button" className="mt-3 text-sm text-brand" onClick={() => setAttempt((value) => value + 1)}>
              {t("retry")}
            </button>
          </div>
        )}
        {form && (
          <div className="mt-5 space-y-4 pb-10">
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <Card title={t("profile")} detail={t("profileDetail")}>
              <div className="flex items-center gap-3">
                <Avatar name={form.displayName} email={user.email} src={form.avatarData} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{form.displayName || user.email}</p>
                  <p className="truncate text-xs text-muted">{user.email}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label htmlFor="avatar-file" className="cursor-pointer text-sm font-medium text-brand">
                  {t("changePhoto")}
                </label>
                <input
                  id="avatar-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  onChange={(event) => {
                    onAvatar(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                {form.avatarData && (
                  <button type="button" className="text-sm text-muted" onClick={() => patch({ avatarData: "" })}>
                    {t("removePhoto")}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">{t("avatarHint")}</p>
              <label className="mt-4 block text-xs text-muted" htmlFor="display-name">
                {t("displayName")}
              </label>
              <input
                id="display-name"
                value={form.displayName}
                onChange={(event) => patch({ displayName: event.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
              />
              <p className="mt-3 text-xs text-muted">{t("emailAddress")}</p>
              <p className="mt-1 text-sm">{user.email}</p>
              <SaveRow
                saved={saved === "profile"}
                saving={saving === "profile"}
                disabled={!changed(PROFILE_KEYS)}
                onClick={() => void save("profile")}
              />
            </Card>

            <Card title={t("emailPreferences")} detail={t("emailPreferencesDetail")}>
              <label className="block text-xs text-muted" htmlFor="language">
                {t("language")}
              </label>
              <select
                id="language"
                value={form.language}
                onChange={(event) => patch({ language: event.target.value as Language })}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none"
              >
                <option value="en">{t("english")}</option>
                <option value="es">{t("spanish")}</option>
              </select>
              <label className="mt-4 block text-xs text-muted" htmlFor="time-zone">
                {t("timeZone")}
              </label>
              <p className="mt-1 text-xs text-muted">{t("timeZoneDetail")}</p>
              <div className="mt-1">
                <TimeZoneSelect id="time-zone" value={form.timeZone} onChange={(timeZone) => patch({ timeZone })} />
              </div>
              <p className="mt-4 text-xs text-muted">{t("signature")}</p>
              <p className="mt-1 text-xs text-muted">{t("signatureDetail")}</p>
              <div className="mt-2 overflow-hidden rounded-lg border border-line">
                <MailEditor
                  seed={baseline?.signatureHtml || "<p></p>"}
                  seedKey={`signature-${editorEpoch}`}
                  placeholder={t("signaturePlaceholder")}
                  minHeight={96}
                  onChange={(html) => patch({ signatureHtml: html })}
                />
              </div>
              <SaveRow
                saved={saved === "mail"}
                saving={saving === "mail"}
                disabled={!changed(MAIL_KEYS)}
                onClick={() => void save("mail")}
              />
            </Card>

            <Card title={t("appearance")} detail={t("appearanceDetail")}>
              <div className="inline-flex rounded-full bg-canvas p-1" role="group" aria-label={t("appearance")}>
                <Segment
                  active={form.theme === "light"}
                  onClick={() => {
                    patch({ theme: "light" });
                    applyTheme("light");
                  }}
                >
                  {t("light")}
                </Segment>
                <Segment
                  active={form.theme === "dark"}
                  onClick={() => {
                    patch({ theme: "dark" });
                    applyTheme("dark");
                  }}
                >
                  {t("dark")}
                </Segment>
              </div>
              <SaveRow
                saved={saved === "appearance"}
                saving={saving === "appearance"}
                disabled={!changed(APPEARANCE_KEYS)}
                onClick={() => void save("appearance")}
              />
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
              <SaveRow
                saved={saved === "notifications"}
                saving={saving === "notifications"}
                disabled={!changed(NOTIFY_KEYS)}
                onClick={() => void save("notifications")}
              />
            </Card>

            <Card title={t("accountSecurity")} detail={t("accountSecurityDetail")}>
              <p className="text-xs text-muted">{t("emailAddress")}</p>
              <p className="mt-1 text-sm">{user.email}</p>
              <p className="mt-4 text-xs text-muted">{t("signedIn")}</p>
              <p className="mt-1 text-sm">{t("sessionActive")}</p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-4 h-9 rounded-full border border-line px-4 text-sm font-medium hover:bg-canvas"
              >
                {t("logOut")}
              </button>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function normalize(settings: Settings): Settings {
  return { ...settings, avatarData: settings.avatarData || "", signatureHtml: settings.signatureHtml || "" };
}

function snapshot(settings: Settings) {
  return JSON.stringify({
    displayName: settings.displayName,
    signatureHtml: settings.signatureHtml,
    language: settings.language,
    timeZone: settings.timeZone,
    theme: settings.theme,
    notifyDesktop: settings.notifyDesktop,
    notifySound: settings.notifySound,
    avatarData: settings.avatarData,
  });
}

function Avatar({ name, email, src }: { name: string; email: string; src: string }) {
  const image = avatarSrc(src);
  if (image) return <img src={image} alt="" className="h-12 w-12 rounded-full object-cover" />;
  return (
    <span className="grid h-12 w-12 place-items-center rounded-full bg-mint text-sm font-semibold text-brand">
      {initials(name, email)}
    </span>
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

function SaveRow({ saved, saving, disabled, onClick }: { saved: boolean; saving: boolean; disabled: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || saving}
        className="h-9 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
      >
        {saving ? t("saving") : t("save")}
      </button>
      {saved && !saving && (
        <span className="text-sm text-muted" role="status">
          {t("saved")}
        </span>
      )}
    </div>
  );
}

function TimeZoneSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const zones = useMemo(() => {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
    const pinned = ["Asia/Dhaka", "UTC", "America/New_York", "Europe/London"];
    return [...pinned.filter((zone) => supported.includes(zone)), ...supported.filter((zone) => !pinned.includes(zone))];
  }, []);
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none">
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}
