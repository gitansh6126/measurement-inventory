"use client";

import { useCallback, useState } from "react";
import { api } from "./api";
import { errorText, queryClient, useApi } from "./useApi";

/**
 * One per-user screen setting (V2 plan §1.10), stored server-side under the signed-in user
 * (/api/me/preferences/:key), so it follows the user across devices and never leaks to
 * another user. Saving updates the screen at once and does not clear other cached data.
 */
export function usePreference<T>(key: string, fallback: T) {
  const path = `/me/preferences/${key}`;
  const { data, loading } = useApi<{ value: T | null }>(path);
  const [error, setError] = useState("");
  const value = (data?.value ?? fallback) as T;
  const save = useCallback(
    async (next: T | null) => {
      setError("");
      queryClient.setQueryData(["api", path], { key, value: next });
      try {
        await (next === null
          ? api(path, { method: "DELETE", keepCache: true })
          : api(path, { method: "PUT", body: { value: next }, keepCache: true }));
      } catch (e) {
        setError(errorText(e));
        await queryClient.invalidateQueries({ queryKey: ["api", path] });
      }
    },
    [key, path],
  );
  return { value, save, error, ready: !!data || !loading };
}
