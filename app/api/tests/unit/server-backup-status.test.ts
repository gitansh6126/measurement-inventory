import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { describeProblems, parseStatusLine, readServerBackupStatus } from "../../src/lib/server-backup-status.js";

const now = new Date("2026-10-31T12:00:00.000Z");

describe("server backup status", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it("parses the lines written by backup.ps1 and restore-test.ps1 (with the PowerShell BOM)", () => {
    const ok = parseStatusLine("\uFEFF2026-10-30T20:45:10.1234567+05:30 OK 20261030-204510 (3.2 MB) local + copy in E:\\RS\\client\r\n", now);
    expect(ok).toMatchObject({ ok: true, text: "20261030-204510 (3.2 MB) local + copy in E:\\RS\\client" });
    expect(ok!.ageHours).toBeCloseTo(20.7, 1);
    expect(parseStatusLine("2026-10-30T20:45:10Z FAILED pg_dump failed (1)", now)).toMatchObject({ ok: false, text: "pg_dump failed (1)" });
    expect(parseStatusLine("2026-10-26T13:00:00Z PASS C:\\backups\\client\\x", now)?.ok).toBe(true);
    expect(parseStatusLine("2026-10-26T13:00:00Z FAIL query failed", now)?.ok).toBe(false);
    expect(parseStatusLine("garbage", now)).toBeNull();
    expect(parseStatusLine("not-a-date OK x", now)).toBeNull();
  });

  it("reports missing, failed and old backups", () => {
    const line = (ok: boolean, ageHours: number) => ({ at: "", ok, text: "why", ageHours });
    expect(describeProblems(line(true, 20), line(true, 100))).toEqual([]);
    expect(describeProblems(null, null)).toEqual(["No automatic backup has run on this PC yet."]);
    expect(describeProblems(line(false, 1), null)[0]).toContain("FAILED: why");
    expect(describeProblems(line(true, 50), null)[0]).toContain("2 day(s) old");
    expect(describeProblems(line(true, 1), line(false, 1))[0]).toContain("restore test FAILED");
    expect(describeProblems(line(true, 1), line(true, 300))[0]).toContain("more than a week");
  });

  it("reads the files, and is not configured without them (hosted)", async () => {
    expect(await readServerBackupStatus({}, true, now)).toEqual({ configured: false, required: true, backup: null, restoreTest: null, problems: [] });

    const dir = await mkdtemp(path.join(tmpdir(), "rs-status-"));
    dirs.push(dir);
    const backup = path.join(dir, "client-backup-status.txt");
    const missing = path.join(dir, "client-restore-test-status.txt");
    expect((await readServerBackupStatus({ backup, restoreTest: missing }, true, now)).problems).toHaveLength(1);

    await writeFile(backup, "2026-10-31T10:00:00Z OK fine\n");
    const status = await readServerBackupStatus({ backup, restoreTest: missing }, true, now);
    expect(status).toMatchObject({ configured: true, backup: { ok: true, ageHours: 2 }, restoreTest: null, problems: [] });

    await writeFile(backup, "2026-10-31T10:00:00Z FAILED disk full\n");
    expect((await readServerBackupStatus({ backup }, false, now)).problems).toEqual([]);
  });
});
