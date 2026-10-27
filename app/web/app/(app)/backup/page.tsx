"use client";

import { useState, useRef, type ChangeEvent, type FormEvent } from "react";
import {
  BoxesIcon,
  CartIcon,
  DatabaseIcon,
  DownloadIcon,
  LayersIcon,
  PackageIcon,
  TruckIcon,
  UploadIcon,
  UsersIcon,
  WarnIcon,
} from "@/components/icons";
import { Restricted } from "@/components/Restricted";
import { Alert, PageHeader, StatCell, StatStrip } from "@/components/ui";
import { errorText, useApi } from "@/lib/useApi";

interface SummaryData {
  categoriesCount: number;
  partiesCount: number;
  productGroupsCount: number;
  productVariationsCount: number;
  salesCount: number;
  purchasesCount: number;
  stockMovementsCount: number;
  imagesCount: number;
}

interface InspectResponse {
  valid: boolean;
  format: "ZIP" | "JSON";
  manifest: {
    format: string;
    backupVersion: string;
    exportTimestamp: string;
    environment: string;
    company: {
      id: string;
      name: string;
    };
    recordCounts: {
      categories: number;
      parties: number;
      productGroups: number;
      productVariations: number;
      documentCounters: number;
      sales: number;
      saleLines: number;
      purchases: number;
      purchaseLines: number;
      stockMovements: number;
      images: number;
      users?: number;
    };
    imageMappings?: Array<{
      id: string;
      archivePath: string;
      mimeType: string;
      bytes: number;
    }>;
  };
  sample?: {
    firstProduct?: string;
    totalImagesInZip?: number;
  };
}

export default function BackupPage() {
  return (
    <Restricted permission="user.manage">
      <BackupManager />
    </Restricted>
  );
}

function BackupManager() {
  const { data: summary, reload: reloadSummary } = useApi<SummaryData>("/backup/summary");

  const [downloading, setDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // Restore states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectData, setInspectData] = useState<InspectResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{
    success: boolean;
    message: string;
    restoredCounts?: Record<string, number>;
  } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleDownload() {
    setDownloading(true);
    setDownloadSuccess(null);
    try {
      const res = await fetch("/api/backup", {
        headers: { Accept: "application/zip" },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to generate ZIP backup (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : `rs-inventory-backup-${new Date().toISOString().slice(0, 10)}.zip`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDownloadSuccess(`Complete backup archive downloaded: ${filename} (${(blob.size / (1024 * 1024)).toFixed(2)} MB)`);
    } catch (err) {
      alert(`Download failed: ${errorText(err)}`);
    } finally {
      setDownloading(false);
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setParseError(null);
    setInspectData(null);
    setRestoreResult(null);
    setRestoreError(null);
    setConfirmed(false);
    setInspecting(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const res = await fetch("/api/backup/inspect", {
        method: "POST",
        headers: {
          "Content-Type": file.name.endsWith(".zip") ? "application/zip" : "application/json",
        },
        body: arrayBuffer,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || `Inspection failed (${res.status})`);
      }
      setInspectData(data);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Failed to inspect backup archive");
    } finally {
      setInspecting(false);
    }
  }

  async function handleRestoreSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedFile || !inspectData || !confirmed) return;

    if (!window.confirm("ARE YOU SURE? This will overwrite existing inventory and document records with the backup archive data and images.")) {
      return;
    }

    setRestoring(true);
    setRestoreError(null);
    setRestoreResult(null);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const res = await fetch("/api/backup/restore?confirm=true", {
        method: "POST",
        headers: {
          "Content-Type": selectedFile.name.endsWith(".zip") ? "application/zip" : "application/json",
          "x-confirm": "true",
        },
        body: arrayBuffer,
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result?.error?.message || `Restore failed (${res.status})`);
      }

      setRestoreResult(result);
      setSelectedFile(null);
      setInspectData(null);
      setConfirmed(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await reloadSummary();
    } catch (err) {
      setRestoreError(errorText(err));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Backup & Restore"
        subtitle="Complete inventory backup packaging inventory data and media into a single downloadable ZIP"
      />

      {summary && (
        <StatStrip cols={5}>
          <StatCell
            icon={<PackageIcon className="h-4 w-4" />}
            label="Products"
            value={summary.productGroupsCount}
            sub={`${summary.productVariationsCount} variations`}
            tone="blue"
          />
          <StatCell
            icon={<BoxesIcon className="h-4 w-4" />}
            label="Stock Movements"
            value={summary.stockMovementsCount}
            sub="ledger records"
            tone="orange"
          />
          <StatCell
            icon={<CartIcon className="h-4 w-4" />}
            label="Sales Orders"
            value={summary.salesCount}
            sub="documents"
            tone="green"
          />
          <StatCell
            icon={<TruckIcon className="h-4 w-4" />}
            label="Purchases"
            value={summary.purchasesCount}
            sub="documents"
            tone="violet"
          />
          <StatCell
            icon={<UsersIcon className="h-4 w-4" />}
            label="Contacts & Media"
            value={summary.partiesCount}
            sub={`${summary.imagesCount} images`}
            tone="slate"
          />
        </StatStrip>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* DOWNLOAD CARD */}
        <div className="card flex flex-col justify-between p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-600">
                  <DownloadIcon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Complete Inventory Backup</h2>
                  <p className="text-xs text-slate-500">One downloadable ZIP file</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                Recommended
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Downloads a complete archive containing all catalog items, historical stock transactions,
              contacts, and physical product photos packaged into one portable ZIP.
            </p>

            {/* Recommended Archive Manifest Breakdown */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5 text-xs">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                  inventory.json
                </span>
                <span className="text-slate-600">
                  Products, SKUs, variations, measurements, units, stock data, and relationships.
                </span>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  images/
                </span>
                <span className="text-slate-600">
                  All associated product images, preserving filenames and references.
                </span>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  manifest.json
                </span>
                <span className="text-slate-600">
                  Backup version, export timestamp, record counts, and image mappings.
                </span>
              </div>
            </div>

            {downloadSuccess && (
              <Alert kind="success">
                {downloadSuccess}
              </Alert>
            )}
          </div>

          <div className="pt-6">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 font-medium"
            >
              <DownloadIcon className="h-4 w-4" />
              {downloading ? "Packaging ZIP Archive…" : "Download Backup (.zip)"}
            </button>
          </div>
        </div>

        {/* RESTORE CARD */}
        <div className="card flex flex-col justify-between p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <UploadIcon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Restore Backup</h2>
                <p className="text-xs text-slate-500">Validate archive before importing data and images</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Upload an RS Inventory backup archive (<code className="text-slate-800">.zip</code> or legacy{" "}
              <code className="text-slate-800">.json</code>). The archive is thoroughly inspected and validated
              before restoring records and physical media in one atomic transaction.
            </p>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Select Backup Archive
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.json,application/zip,application/json"
                onChange={handleFileChange}
                disabled={restoring || inspecting}
                className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer border border-dashed border-slate-300 rounded-lg p-3 bg-slate-50 hover:bg-slate-100/50 transition-colors"
              />
            </div>

            {inspecting && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                Validating archive structure and reading manifest…
              </div>
            )}

            {parseError && (
              <Alert kind="error">
                {parseError}
              </Alert>
            )}

            {inspectData && (
              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Archive Validated:
                  </span>
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">
                    {inspectData.format} · v{inspectData.manifest.backupVersion}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-600">
                  <div>Company: <strong className="text-slate-800">{inspectData.manifest.company?.name}</strong></div>
                  <div>Environment: <strong className="text-slate-800">{inspectData.manifest.environment}</strong></div>
                  <div>Exported: <strong className="text-slate-800">{new Date(inspectData.manifest.exportTimestamp).toLocaleDateString()}</strong></div>
                  <div>Images in Archive: <strong className="text-slate-800">{inspectData.manifest.recordCounts.images} files</strong></div>
                </div>
                <div className="border-t border-slate-100 pt-1.5 text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>• Products: <b>{inspectData.manifest.recordCounts.productGroups}</b></span>
                  <span>• Variations: <b>{inspectData.manifest.recordCounts.productVariations}</b></span>
                  <span>• Stock Ledger: <b>{inspectData.manifest.recordCounts.stockMovements}</b></span>
                  <span>• Sales: <b>{inspectData.manifest.recordCounts.sales}</b></span>
                  <span>• Purchases: <b>{inspectData.manifest.recordCounts.purchases}</b></span>
                  <span>• Contacts: <b>{inspectData.manifest.recordCounts.parties}</b></span>
                </div>
              </div>
            )}

            {restoreError && (
              <Alert kind="error">
                {restoreError}
              </Alert>
            )}

            {restoreResult && (
              <Alert kind="success">
                <div>
                  <strong>{restoreResult.message}</strong>
                  {restoreResult.restoredCounts && (
                    <div className="mt-1 text-xs opacity-90">
                      Restored {restoreResult.restoredCounts.productGroups} products ({restoreResult.restoredCounts.productVariations} variations), {restoreResult.restoredCounts.stockMovements} stock movements, {restoreResult.restoredCounts.sales} sales, {restoreResult.restoredCounts.purchases} purchases, {restoreResult.restoredCounts.parties} contacts, and {restoreResult.restoredCounts.images} image files.
                    </div>
                  )}
                </div>
              </Alert>
            )}
          </div>

          {inspectData && (
            <form onSubmit={handleRestoreSubmit} className="pt-4 space-y-4 border-t border-slate-100 mt-4">
              <div className="rounded-md bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-rose-900">
                  <WarnIcon className="h-4 w-4 text-rose-600 shrink-0" />
                  Warning: Data &amp; Image Replacement
                </div>
                <p>
                  Restoring will replace existing product catalog items, stock movements, customer/supplier
                  records, and media with the archive contents. Audit logs and login credentials remain preserved.
                </p>
                <label className="flex items-center gap-2 pt-1 font-medium text-rose-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                  />
                  I confirm that I want to restore data and images from this backup.
                </label>
              </div>

              <button
                type="submit"
                disabled={!confirmed || restoring}
                className="btn-danger w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 font-medium"
              >
                <DatabaseIcon className="h-4 w-4" />
                {restoring ? "Restoring Data & Images…" : "Restore Backup"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
