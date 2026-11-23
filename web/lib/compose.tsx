"use client";

import { createContext, useContext, useMemo, useState } from "react";

export type ComposeRequest = {
  mode: "new" | "reply" | "replyAll" | "forward";
  folderId?: string;
  uid?: number;
};

type ComposeValue = {
  request: ComposeRequest | null;
  openCompose: (request?: ComposeRequest) => void;
  closeCompose: () => void;
};

const ComposeContext = createContext<ComposeValue | null>(null);

export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ComposeRequest | null>(null);
  const value = useMemo<ComposeValue>(
    () => ({
      request,
      openCompose(next = { mode: "new" }) {
        setRequest(next);
      },
      closeCompose() {
        setRequest(null);
      },
    }),
    [request],
  );
  return <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>;
}

export function useCompose() {
  const value = useContext(ComposeContext);
  if (!value) throw new Error("ComposeProvider is missing");
  return value;
}
