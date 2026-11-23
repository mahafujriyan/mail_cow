import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const base = process.env.API_INTERNAL_URL || "http://127.0.0.1:4100";
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, base);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  headers.set("x-forwarded-for", forwarded || "127.0.0.1");
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Buffer.from(await request.arrayBuffer());
  }
  const upstream = await fetch(target, init);
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "set-cookie" || name === "content-encoding" || name === "content-length" || name === "transfer-encoding") return;
    responseHeaders.append(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie?.() || []) {
    responseHeaders.append("set-cookie", cookie);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
