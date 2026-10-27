"use client";

import { useCallback, useState } from "react";
import { usePreference } from "./usePreference";

// Grid (cards) and Table are two views of the same data (catalog browse §2.0). The choice is
// saved per user and per screen as the preference "<screen>.view"; switching never refetches.

export type ViewMode = "grid" | "table";

export function useViewMode(screen: string, fallback: ViewMode = "grid") {
  const pref = usePreference<ViewMode>(`${screen}.view`, fallback);
  // The local copy makes the switch instant even before the saved preference answers.
  const [local, setLocal] = useState<ViewMode | null>(null);
  const saved = pref.value === "grid" || pref.value === "table" ? pref.value : fallback;
  const view = local ?? saved;
  const setView = useCallback(
    (v: ViewMode) => {
      setLocal(v);
      void pref.save(v);
    },
    [pref],
  );
  return [view, setView] as const;
}
