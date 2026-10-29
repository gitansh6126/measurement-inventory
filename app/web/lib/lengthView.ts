// How Measured lengths and rates are shown: in metres, feet, or both (owner requests 2026-10-27 and
// 2026-10-28). Not one site-wide setting: each area keeps its own choice, set from a small switch
// in the length / rate column it applies to.
//   stock    — sales and inventory screens, default feet.
//   purchase — purchases, suppliers and vendor prices, default metres.
// A per-browser preference in localStorage; display only — stored lengths, entry fields and
// documents keep the product's own unit.
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from "react";

export type LengthView = "m" | "ft" | "both";
export type LengthScope = "stock" | "purchase";

export const LENGTH_VIEWS: { value: LengthView; label: string; title: string }[] = [
  { value: "m", label: "m", title: "Show lengths in metres" },
  { value: "ft", label: "ft", title: "Show lengths in feet" },
  { value: "both", label: "m+ft", title: "Show lengths in metres and feet" },
];

export const DEFAULT_VIEW: Record<LengthScope, LengthView> = { stock: "ft", purchase: "m" };

const key = (s: LengthScope) => `measure.length_view.${s}`;
const current: Record<LengthScope, LengthView> = { ...DEFAULT_VIEW };
const loaded: Record<LengthScope, boolean> = { stock: false, purchase: false };
const listeners = new Set<() => void>();

const read = (scope: LengthScope): LengthView => {
  if (!loaded[scope] && typeof window !== "undefined") {
    loaded[scope] = true;
    try {
      const v = localStorage.getItem(key(scope));
      if (v === "m" || v === "ft" || v === "both") current[scope] = v;
    } catch {
      // Storage blocked: keep the default.
    }
  }
  return current[scope];
};

export function setLengthView(scope: LengthScope, v: LengthView) {
  current[scope] = v;
  loaded[scope] = true;
  try {
    localStorage.setItem(key(scope), v);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const ScopeContext = createContext<LengthScope>("stock");

/** Puts a subtree in an area: its lengths follow that area's switch. Screens default to "stock". */
export const LengthScopeProvider = ({ scope, children }: { scope: LengthScope; children: ReactNode }) => createElement(ScopeContext.Provider, { value: scope }, children);

export const useLengthScope = () => useContext(ScopeContext);

// The area of the component rendering now. fmtLen / fmtRate are plain functions, so a component
// that formats lengths calls useLengthView() first (render is synchronous) and they read it here.
let active: LengthScope = "stock";

/** The view fmtLen / fmtRate use: the one of the area last entered through useLengthView(). */
export const getLengthView = () => read(active);

/** Re-renders the caller when its area's view changes and makes that area the one formatters use. */
export const useLengthView = () => {
  const scope = useContext(ScopeContext);
  const view = useSyncExternalStore(subscribe, () => read(scope), () => DEFAULT_VIEW[scope]);
  active = scope;
  return view;
};
