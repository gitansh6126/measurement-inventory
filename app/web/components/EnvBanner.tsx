"use client";

import { useEffect, useState } from "react";
import { api, type VersionInfo } from "@/lib/api";

const LABEL: Record<VersionInfo["environment"], string> = {
  CLIENT_READY: "Live",
  DEMO: "Demo",
  TEST: "TEST",
};

// Demo/Test are deliberately loud (striped amber) so they can never be mistaken for live data.
const STYLE: Record<VersionInfo["environment"], string> = {
  CLIENT_READY: "bg-emerald-50 text-emerald-800",
  DEMO: "bg-[repeating-linear-gradient(-45deg,#f59e0b_0_14px,#fbbf24_14px_28px)] font-semibold text-amber-950",
  TEST: "bg-[repeating-linear-gradient(-45deg,#f59e0b_0_14px,#fbbf24_14px_28px)] font-semibold text-amber-950",
};

/** Always-visible environment identity (v1/ENVIRONMENTS.md). */
export function EnvBanner() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<VersionInfo>("/version").then(setInfo, () => setFailed(true));
  }, []);

  // Sticky 28px strip above the shell (the sidebar and top bar are offset by it).
  const base = "no-print sticky top-0 z-50 flex h-7 items-center gap-x-3 overflow-hidden whitespace-nowrap px-4 text-xs";
  if (failed) return <div className={`${base} bg-rose-600 text-white`}>Server unreachable — environment unknown</div>;
  if (!info) return <div className={`${base} bg-slate-100`} aria-hidden />;

  const deployed = new Date(info.deploymentTimestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  return (
    <div className={`${base} ${STYLE[info.environment]}`} role="status">
      <strong>{LABEL[info.environment]}</strong>
      <span>
        v{info.releaseVersion} · deployed {deployed} · schema {info.migrationVersion ?? "not migrated"}
      </span>
      {info.environment === "DEMO" && (
        <a href="/demo-data" className="ml-auto rounded bg-white/90 px-2 py-0.5 text-xs font-semibold text-amber-950 shadow-sm hover:bg-white border border-amber-900/20">
          Demo Data Tools →
        </a>
      )}
      {info.switchUrl && (
        // Opens the other environment; it has its own sign-in, data and session.
        <a href={info.switchUrl} className={`${info.environment === "DEMO" ? "ml-2" : "ml-auto"} rounded bg-white/80 px-2 py-0.5 font-semibold text-slate-900 shadow-sm hover:bg-white`}>
          {info.environment === "CLIENT_READY" ? "Switch to Demo company →" : "Switch to Real company →"}
        </a>
      )}
    </div>
  );
}
