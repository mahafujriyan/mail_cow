"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "ready") {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas">
        <div className="h-0.5 w-24 overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/2 animate-pulse bg-brand" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
