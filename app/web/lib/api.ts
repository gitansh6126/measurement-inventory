// Same-origin JSON client. The session lives in an HttpOnly cookie the browser sends
// automatically; no token is ever readable by page scripts.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    // V2: structured error details (e.g. shortages with canOversell, currentVersion).
    readonly details?: unknown,
    // Audit M5: the API's X-Request-Id, to find this failure in the API log.
    readonly requestId?: string,
  ) {
    super(message);
  }
}

// Called after every successful write (set by lib/useApi.ts) to clear cached GET results.
let onWrite: (() => void) | null = null;
export function setWriteListener(fn: () => void) {
  onWrite = fn;
}

// Audit M4: called when a signed-in screen gets 401 (session expired or revoked; set by
// lib/useApi.ts). Sign-in itself, the first /auth/me check (app layout) and public calls are excluded.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedListener(fn: () => void) {
  onUnauthorized = fn;
}
const PUBLIC_PATHS = /^\/(auth\/(login|me|password-reset\/)|version)/;

// keepCache: a write that changes no business data (e.g. a screen preference) does not clear
// the cached screens.
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; keepCache?: boolean } = {}): Promise<T> {
  const isCust = typeof window !== "undefined" && window.sessionStorage?.getItem("rs_customer_mode") === "1";
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (isCust) headers["X-Customer-Mode"] = "1";

  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: Object.keys(headers).length ? headers : undefined,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !PUBLIC_PATHS.test(path)) onUnauthorized?.();
    const requestId = data?.error?.requestId ?? res.headers.get("x-request-id") ?? undefined;
    throw new ApiError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details, requestId);
  }
  if ((init.method ?? "GET") !== "GET" && !init.keepCache) onWrite?.();
  return data as T;
}

export type Role = "admin" | "sales_manager" | "sales_staff";
export interface Me {
  user: { id: string; name: string; email: string; role: Role };
  permissions: string[];
  isCustomerMode?: boolean;
}
export interface VersionInfo {
  environment: "CLIENT_READY" | "DEMO" | "TEST";
  releaseVersion: string;
  deploymentTimestamp: string;
  migrationVersion: string | null;
  git?: {
    commit: string;
    branch: string | null;
    tag: string | null;
    dirty: boolean;
    url: string | null;
    commitUrl: string | null;
    branchUrl: string | null;
  } | null;
  /** Paired environment address (Client Ready ↔ Demo); null when not configured. */
  switchUrl: string | null;
}
