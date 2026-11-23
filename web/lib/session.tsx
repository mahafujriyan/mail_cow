"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, setCsrf } from "@/lib/api";
import type { Settings, SessionUser } from "@/lib/types";

type Status = "loading" | "anonymous" | "ready";

type SessionValue = {
  status: Status;
  user: SessionUser | null;
  refresh: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
  updateSettings: (settings: Settings) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

function applyTheme(theme: "light" | "dark" | undefined) {
  if (!theme || typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("sbr-theme", theme);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<SessionUser | null>(null);
  const epoch = useRef(0);

  async function refresh() {
    const id = ++epoch.current;
    const csrf = await api<{ csrfToken: string }>("/api/auth/csrf");
    if (id !== epoch.current) return;
    setCsrf(csrf.csrfToken);
    try {
      const me = await api<SessionUser>("/api/auth/me");
      if (id !== epoch.current) return;
      setUserState(me);
      setStatus("ready");
      applyTheme(me.settings.theme);
    } catch {
      if (id !== epoch.current) return;
      setUserState(null);
      setStatus("anonymous");
    }
  }

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setUserState(null);
      setStatus("anonymous");
    };
    window.addEventListener("sbr-unauthorized", onUnauthorized);
    return () => window.removeEventListener("sbr-unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (user?.settings.theme) applyTheme(user.settings.theme);
    if (user?.settings.language) document.documentElement.lang = user.settings.language;
  }, [user?.settings.theme, user?.settings.language]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      refresh,
      setUser(next) {
        epoch.current += 1;
        setUserState(next);
        setStatus(next ? "ready" : "anonymous");
        if (next) applyTheme(next.settings.theme);
      },
      updateSettings(settings) {
        setUserState((current) => (current ? { ...current, settings } : current));
        applyTheme(settings.theme);
      },
    }),
    [status, user],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is missing");
  return value;
}
