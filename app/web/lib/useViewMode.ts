"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { usePreference } from "./usePreference";

// Grid (cards) and Table are two views of the same data (catalog browse §2.0). The choice is
// saved per user and per screen as the preference "<screen>.view"; switching never refetches.
// Phones always open in Grid and keep their own choice ("<screen>.view.mobile"), so a Table
// picked on the desktop never lands on a small screen.

export type ViewMode = "grid" | "table";

const MOBILE = "(max-width: 767px)";

function subscribe(cb: () => void) {
  const m = window.matchMedia(MOBILE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/** True below the md breakpoint (phones). False during server render. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE).matches, () => false);
}

export function useViewMode(screen: string, fallback: ViewMode = "grid") {
  const mobile = useIsMobile();
  const key = mobile ? `${screen}.view.mobile` : `${screen}.view`;
  const def: ViewMode = mobile ? "grid" : fallback;
  const pref = usePreference<ViewMode>(key, def);
  // The local copy makes the switch instant even before the saved preference answers.
  const [local, setLocal] = useState<Record<string, ViewMode>>({});
  const saved = pref.value === "grid" || pref.value === "table" ? pref.value : def;
  const view = local[key] ?? saved;
  const setView = useCallback(
    (v: ViewMode) => {
      setLocal((l) => ({ ...l, [key]: v }));
      void pref.save(v);
    },
    [key, pref],
  );
  return [view, setView] as const;
}
