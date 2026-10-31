"use client";

import { useEffect, useRef, useState } from "react";

/** `value`, updated only after it has stopped changing for `ms` (search boxes). */
export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Debounced, trimmed search text. `onChange` runs only when the debounced text actually
 * changes (not on first render), so a list can go back to page 1 without losing a
 * `?page=` that came in with the URL.
 */
export function useDebouncedSearch(search: string, onChange?: () => void, ms = 250) {
  const q = useDebounced(search.trim(), ms);
  const last = useRef(q);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (last.current === q) return;
    last.current = q;
    cb.current?.();
  }, [q]);
  return q;
}
