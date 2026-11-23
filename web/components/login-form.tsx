"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mark } from "@/components/brand";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Settings } from "@/lib/types";

export function LoginForm() {
  const { t } = useI18n();
  const { setUser, status } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (status === "ready") {
    router.replace("/mail");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await api<{ email: string; demo: boolean; settings: Settings }>("/api/auth/login", {
        method: "POST",
        json: { email, password },
      });
      setUser({ email: result.email, demo: result.demo, settings: result.settings });
      router.replace("/mail");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("couldNotLoad"));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4">
      <form onSubmit={submit} className="w-full max-w-[400px] rounded-2xl border border-line bg-surface px-8 py-8">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[15px] font-semibold tracking-[-0.03em]">{t("product")}</span>
        </div>
        <h1 className="mt-8 text-[28px] font-semibold tracking-[-0.04em]">{t("signIn")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{t("loginHint")}</p>
        <label className="mt-6 block text-sm font-medium" htmlFor="email">
          {t("email")}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1.5 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
        />
        <label className="mt-4 block text-sm font-medium" htmlFor="password">
          {t("password")}
        </label>
        <div className="relative mt-1.5">
          <input
            id="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 w-full rounded-lg border border-line bg-surface px-3 pr-11 text-sm outline-none focus:border-brand"
          />
          <button
            type="button"
            aria-label={show ? t("hidePassword") : t("showPassword")}
            onClick={() => setShow((value) => !value)}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-muted"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 h-11 w-full rounded-full bg-brand text-sm font-semibold text-on-brand hover:bg-[#0e3329] disabled:opacity-60"
        >
          {pending ? t("signingIn") : t("signIn")}
        </button>
      </form>
    </main>
  );
}
