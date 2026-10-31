"use client";

// Display panel (owner request 2026-10-28, updated 2026-10-29): opened from the sidebar, it slides
// out beside it and changes text size and spacing live while the sliders move. No dimming backdrop, so
// the page underneath shows the result as you adjust. Saved per browser (lib/displayPrefs.ts).
// The page width is always full width everywhere (owner request 2026-10-29).
import { useEffect, useRef, type PointerEvent } from "react";
import { CloseIcon } from "@/components/icons";
import { DEFAULT_PREFS, LIMITS, setDisplayPrefs, useDisplayPrefs, type DisplayPrefs } from "@/lib/displayPrefs";

const PRESETS: { label: string; prefs: DisplayPrefs }[] = [
  { label: "Compact", prefs: { text: 0.9, space: 0.75 } },
  { label: "Default", prefs: DEFAULT_PREFS },
  { label: "Large", prefs: { text: 1.15, space: 1.2 } },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Slider({ label, value, shown, min, max, step, onChange, ends }: {
  label: string;
  value: number;
  shown: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  ends: [string, string];
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-800">{shown}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-brand-600"
      />
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </label>
  );
}

export function DisplayPanel({ onClose }: { onClose: () => void }) {
  const prefs = useDisplayPrefs();
  const ref = useRef<HTMLDivElement>(null);

  // Auto-hide: once the mouse has been over the panel, moving it out closes
  // the panel after a short grace delay; coming back in cancels it. Not while a slider is being dragged
  // (button held), and not for touch, where there is no hover.
  const hideTimer = useRef<number | undefined>(undefined);
  const cancelHide = () => window.clearTimeout(hideTimer.current);
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons !== 0) return;
    cancelHide();
    hideTimer.current = window.setTimeout(onClose, 400);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(hideTimer.current);
    };
  }, [onClose]);

  const same = (p: DisplayPrefs) => p.text === prefs.text && p.space === prefs.space;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Display settings"
      onPointerEnter={cancelHide}
      onPointerLeave={onLeave}
      className="no-print fixed bottom-0 left-0 top-0 z-50 flex w-72 max-w-[100vw] animate-fade-in flex-col border-r border-slate-200 bg-white shadow-2xl outline-none lg:left-16"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Display</div>
          <div className="text-[11px] text-slate-500">Changes show as you adjust · this browser only</div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close display settings">
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Quick presets</div>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setDisplayPrefs(p.prefs)}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium ${same(p.prefs) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Text size"
          value={prefs.text}
          shown={pct(prefs.text)}
          {...LIMITS.text}
          onChange={(text) => setDisplayPrefs({ text })}
          ends={["Smaller", "Larger"]}
        />

        <Slider
          label="Spacing"
          value={prefs.space}
          shown={pct(prefs.space)}
          {...LIMITS.space}
          onChange={(space) => setDisplayPrefs({ space })}
          ends={["Tight", "Roomy"]}
        />
        <p className="text-[11px] leading-relaxed text-slate-500">
          Spacing changes the padding and gaps inside cards, tables, forms and lists. Printed documents always use the default size.
        </p>
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <button onClick={() => setDisplayPrefs(DEFAULT_PREFS)} disabled={same(DEFAULT_PREFS)} className="btn-secondary w-full">
          Reset to default
        </button>
      </div>
    </div>
  );
}
