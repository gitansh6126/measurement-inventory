// Display preferences (owner request 2026-10-28): text size and spacing, chosen from the
// sidebar's Display panel. A per-browser preference in localStorage, applied as CSS variables on
// <html> (postcss-ui-scale.cjs multiplies font sizes and paddings/margins/gaps by them). Printed
// documents always use the defaults (globals.css @media print). Full screen width is kept always
// everywhere (owner request 2026-10-29).
import { useSyncExternalStore } from "react";
import { DISPLAY_PREFS_KEY } from "./displayPrefsBoot";

export type DisplayPrefs = { text: number; space: number };

export const DEFAULT_PREFS: DisplayPrefs = { text: 1, space: 1 };
export const LIMITS = {
  text: { min: 0.85, max: 1.3, step: 0.05 },
  space: { min: 0.6, max: 1.5, step: 0.05 },
};

const KEY = DISPLAY_PREFS_KEY;
let current: DisplayPrefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && v >= lo && v <= hi ? v : d);

const read = (): DisplayPrefs => {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (v && typeof v === "object") {
        current = {
          text: clamp(v.text, LIMITS.text.min, LIMITS.text.max, DEFAULT_PREFS.text),
          space: clamp(v.space, LIMITS.space.min, LIMITS.space.max, DEFAULT_PREFS.space),
        };
      }
    } catch {
      // Storage blocked or bad JSON: keep the defaults.
    }
  }
  return current;
};

export function applyDisplayPrefs(p: DisplayPrefs) {
  const s = document.documentElement.style;
  s.setProperty("--ui-text", String(p.text));
  s.setProperty("--ui-space", String(p.space));
  s.removeProperty("--ui-page-w");
}

export function setDisplayPrefs(patch: Partial<DisplayPrefs>) {
  current = { ...read(), ...patch };
  applyDisplayPrefs(current);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useDisplayPrefs = () => useSyncExternalStore(subscribe, read, () => DEFAULT_PREFS);
