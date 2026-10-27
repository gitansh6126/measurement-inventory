"use client";

import { QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError, api, setUnauthorizedListener, setWriteListener } from "./api";

// V2 (plan §1.4, backlog F1): GET results are cached by path with TanStack Query, so going back
// to a screen shows its last data instantly while a fresh copy loads in the background, and two
// components asking for the same path share one request. Any successful write (api() with a
// method other than GET) clears the whole cache, so no screen can show data older than a change.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Show cached data immediately, refetch in the background on every mount.
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});
setWriteListener(() => void queryClient.invalidateQueries());

// Audit M4: an expired or revoked session mid-use goes back to sign-in (once), then returns here.
let leaving = false;
setUnauthorizedListener(() => {
  if (leaving || typeof window === "undefined" || window.location.pathname.startsWith("/login")) return;
  leaving = true;
  queryClient.clear();
  const here = window.location.pathname + window.location.search;
  window.location.replace(`/login?expired=1&next=${encodeURIComponent(here)}`);
});

/**
 * Loads a GET endpoint; `reload` re-fetches after a write. A null path skips loading.
 * A newer path supersedes an older one: TanStack Query aborts the outdated request, so a slow
 * answer for an older search can never overwrite the results of the newer one.
 */
export function useApi<T>(path: string | null) {
  const q = useQuery<T, Error>({
    queryKey: ["api", path],
    queryFn: ({ signal }) => api<T>(path!, { signal }),
    enabled: !!path,
  });
  const reload = useCallback(async () => {
    if (path) await q.refetch();
  }, [path, q]);
  const error = q.error ? errorText(q.error) : "";
  return { data: (q.data ?? null) as T | null, error, loading: q.isFetching, reload };
}

/**
 * Message for a failed request. A server fault (5xx) carries a short reference to its
 * requestId so the failure can be found in the API log (audit M5); other messages are unchanged.
 */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return "Could not reach the server";
  return e.status >= 500 && e.requestId ? `${e.message} (ref ${e.requestId.slice(0, 8)})` : e.message;
}
