export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let csrfToken = "";

export function setCsrf(token: string) {
  csrfToken = token;
}

export function getCsrf() {
  return csrfToken;
}

type Options = RequestInit & { json?: unknown };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
  }
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string }; csrfToken?: string };
  if (typeof data.csrfToken === "string") setCsrf(data.csrfToken);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("sbr-unauthorized"));
    }
    throw new ApiError(response.status, data.error?.message || "Request failed", data.error?.code);
  }
  return data as T;
}

export function uploadFile(file: File, onProgress?: (ratio: number) => void) {
  return new Promise<{ id: string; name: string; mime: string; size: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-csrf-token", csrfToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error?.message || "Upload failed", data.error?.code));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed"));
    const body = new FormData();
    body.set("file", file);
    xhr.send(body);
  });
}
