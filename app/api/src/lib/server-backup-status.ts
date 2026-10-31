import { readFile } from "node:fs/promises";

// The local server's nightly backup (local-server\backup.ps1) and weekly restore test
// (restore-test.ps1) each write one status line to the data folder's run\ directory:
//   "<ISO time> OK <details>" / "<ISO time> FAILED <reason>"     (backup)
//   "<ISO time> PASS <backup>" / "<ISO time> FAIL <reason>"      (restore test)
// start.ps1 passes the two file paths as BACKUP_STATUS_FILE / RESTORE_TEST_STATUS_FILE.
// Hosted installs (Docker) have no such files: the result is then { configured: false }.

/** A backup older than this is reported as missing: the task runs every evening. */
export const BACKUP_MAX_AGE_HOURS = 26;
/** The restore test runs every Sunday; one missed week is tolerated. */
export const RESTORE_TEST_MAX_AGE_HOURS = 8 * 24 + 12;

export interface StatusLine {
  at: string;
  ok: boolean;
  text: string;
  ageHours: number;
}

export interface ServerBackupStatus {
  configured: boolean;
  /** Problems are only raised for the real company (CLIENT_READY); Demo just shows the facts. */
  required: boolean;
  backup: StatusLine | null;
  restoreTest: StatusLine | null;
  /** Plain-language problems for the admin, empty when everything is fine. */
  problems: string[];
}

export function parseStatusLine(raw: string, now: Date): StatusLine | null {
  const line = raw.replace(/^﻿/, "").trim().split(/\r?\n/)[0] ?? "";
  const m = /^(\S+)\s+(OK|FAILED|PASS|FAIL)\b\s*(.*)$/.exec(line);
  if (!m) return null;
  const [, stamp = "", word, rest = ""] = m;
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return null;
  return {
    at: at.toISOString(),
    ok: word === "OK" || word === "PASS",
    text: rest.trim(),
    ageHours: Math.max(0, Math.round(((now.getTime() - at.getTime()) / 3_600_000) * 10) / 10),
  };
}

export function describeProblems(backup: StatusLine | null, restoreTest: StatusLine | null): string[] {
  const problems: string[] = [];
  if (!backup) problems.push("No automatic backup has run on this PC yet.");
  else if (!backup.ok) problems.push(`The last automatic backup FAILED: ${backup.text}`);
  else if (backup.ageHours > BACKUP_MAX_AGE_HOURS) problems.push(`The last automatic backup is ${Math.floor(backup.ageHours / 24)} day(s) old.`);
  if (restoreTest && !restoreTest.ok) problems.push(`The last weekly restore test FAILED: ${restoreTest.text}`);
  else if (restoreTest && restoreTest.ageHours > RESTORE_TEST_MAX_AGE_HOURS) problems.push("The weekly restore test has not run for more than a week.");
  return problems;
}

async function readLine(file: string | undefined, now: Date): Promise<StatusLine | null> {
  if (!file) return null;
  try {
    return parseStatusLine(await readFile(file, "utf8"), now);
  } catch {
    return null; // not written yet
  }
}

export async function readServerBackupStatus(
  files: { backup?: string; restoreTest?: string },
  required: boolean,
  now = new Date()
): Promise<ServerBackupStatus> {
  if (!files.backup) return { configured: false, required, backup: null, restoreTest: null, problems: [] };
  const [backup, restoreTest] = await Promise.all([readLine(files.backup, now), readLine(files.restoreTest, now)]);
  return { configured: true, required, backup, restoreTest, problems: required ? describeProblems(backup, restoreTest) : [] };
}
