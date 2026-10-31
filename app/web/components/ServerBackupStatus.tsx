"use client";

import Link from "next/link";
import { WarnIcon } from "@/components/icons";
import { useApi } from "@/lib/useApi";

interface StatusLine {
  at: string;
  ok: boolean;
  text: string;
  ageHours: number;
}

interface ServerBackupStatusData {
  configured: boolean;
  required: boolean;
  backup: StatusLine | null;
  restoreTest: StatusLine | null;
  problems: string[];
}

function when(line: StatusLine) {
  const at = new Date(line.at).toLocaleString();
  const age = line.ageHours < 24 ? `${Math.round(line.ageHours)} h ago` : `${Math.floor(line.ageHours / 24)} day(s) ago`;
  return `${at} (${age})`;
}

function Row({ label, line, empty }: { label: string; line: StatusLine | null; empty: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span className="w-40 shrink-0 font-semibold text-slate-700">{label}</span>
      {line ? (
        <span className={line.ok ? "text-slate-700" : "font-semibold text-rose-700"}>
          {line.ok ? "OK" : "FAILED"} · {when(line)}
          {line.text && <span className="block break-all text-xs text-slate-500">{line.text}</span>}
        </span>
      ) : (
        <span className="text-slate-500">{empty}</span>
      )}
    </div>
  );
}

/**
 * Nightly backup + weekly restore test of the shop PC (local-server\backup.ps1, restore-test.ps1).
 * `alertOnly` (dashboard): renders only when there is a problem. Hosted installs render nothing.
 */
export function ServerBackupStatus({ alertOnly = false }: { alertOnly?: boolean }) {
  const { data } = useApi<ServerBackupStatusData>("/backup/server-status");
  if (!data?.configured) return null;
  const bad = data.problems.length > 0;
  if (alertOnly && !bad) return null;

  if (alertOnly) {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        <WarnIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">Automatic backup needs attention</p>
          {data.problems.map((p) => <p key={p}>{p}</p>)}
          <Link href="/backup" className="inline-block font-semibold underline">Open Backup & Restore</Link>
        </div>
      </div>
    );
  }

  return (
    <section
      role={bad ? "alert" : "status"}
      className={`space-y-2 rounded-xl border px-4 py-3 text-sm ${bad ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}
    >
      <h2 className="font-semibold text-slate-900">Automatic backups on this PC</h2>
      {bad && (
        <ul className="list-disc space-y-0.5 pl-5 text-rose-800">
          {data.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <Row label="Nightly backup" line={data.backup} empty="Not run yet" />
      <Row label="Weekly restore test" line={data.restoreTest} empty="Not run yet (Sundays 13:00)" />
      {!data.required && <p className="text-xs text-slate-500">Demo company: problems are only flagged for the real company.</p>}
    </section>
  );
}
