"use client";

import { I18nProvider } from "@/lib/i18n";
import { ComposeProvider } from "@/lib/compose";
import { SessionProvider, useSession } from "@/lib/session";

function LanguageBridge({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  return <I18nProvider language={user?.settings.language || "en"}>{children}</I18nProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LanguageBridge>
        <ComposeProvider>{children}</ComposeProvider>
      </LanguageBridge>
    </SessionProvider>
  );
}
