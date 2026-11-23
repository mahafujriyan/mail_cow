"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MailScreen } from "@/components/mail/mail-screen";

function MailRoute() {
  const params = useParams<{ slug?: string[] }>();
  const search = useSearchParams();
  const slug = params.slug || [];
  const uid = slug[1] ? Number(slug[1]) : undefined;
  return <MailScreen folderId={slug[0]} uid={Number.isFinite(uid) ? uid : undefined} q={search.get("q") || ""} />;
}

export default function MailPage() {
  return (
    <Suspense fallback={null}>
      <MailRoute />
    </Suspense>
  );
}
