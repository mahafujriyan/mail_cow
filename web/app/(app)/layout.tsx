"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { AppShell } from "@/components/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </AuthGate>
  );
}
