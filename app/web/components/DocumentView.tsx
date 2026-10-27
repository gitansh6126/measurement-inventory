"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useCart, type CartLine, type CartMode } from "@/components/CartContext";
import { DocumentHeaderEdit } from "@/components/DocumentHeaderEdit";
import { PrintIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
import { PageHeader, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, formatVariationAttributesString, money } from "@/lib/format";
import { contentsText } from "@/components/sets/SetContents";
import type { SetContentRow } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";

interface Doc {
  id: string;
  number: string;
  status: "COMPLETED" | "CANCELLED" | "REPLACED";
  revision?: number;
  replaces?: { id: string; number: string } | null;
  replacedBy?: { id: string; number: string } | null;
  revisions?: {
    id: string;
    number: string;
    revision: number;
    date: string;
    total: string;
    by: string | null;
    reason: string | null;
    status: "COMPLETED" | "CANCELLED" | "REPLACED";
  }[];
  date: string;
  partyId: string | null;
  partyName: string | null;
  subtotal: string;
  total: string;
  gross: string;
  discount: string;
  notes: string | null;
  createdBy: string | null;
  payment: { mode: string | null; status: string | null; amountPaid: string | null } | null;
  void: { reason: string; at: string; by: string | null; kind?: "CANCELLED" | "REPLACED" } | null;
  lines: {
    id: string;
    lineNo: number;
    variationId: string;
    productId: string | null;
    productName: string;
    shortName: string;
    officialSku: string | null;
    attributes: Record<string, string>;
    attributeUnits?: Record<string, string>;
    unit: string;
    quantity: number;
    price: string;
    /** The unit the price is per: "ft" on a feet + inches line priced per foot (0028). */
    rateUnit?: string;
    discount: string;
    note: string | null;
    lineTotal: string;
    pieces?: any[];
    /** V3.1 grouped lines: the sets on this line. */
    sets?: {
      id: string;
      code: string;
      name: string;
      contents?: SetContentRow[];
      status: string;
      groupId: string;
      /** Measured parts fitted in the set (cancel can release them as free cut pieces). */
      measuredParts?: SetContentRow[];
    }[];
  }[];
}

const PAY_MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque", CREDIT: "Credit" };
const PAY_STATUS: Record<string, string> = { PAID: "Paid", PARTIAL: "Part paid", PENDING: "Pending" };

/**
 * A sale or purchase. Lines show the snapshot taken at the time (main v2 BR-27).
 * V2: discount and line notes, payment information, cancel (void) with a reason (D3) — the
 * document stays as recorded and a cancellation note is shown — and a plain A4 print view.
 */
export function DocumentView({ mode, id }: { mode: CartMode; id: string }) {
  const router = useRouter();
  const cart = useCart();
  const isSale = mode === "sale";
  const base = isSale ? "sales" : "purchases";
  const canVoid = useCan(isSale ? "sale.void" : "purchase.void");
  const canEdit = useCan(isSale ? "sale.edit" : "purchase.edit");
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const fromName = searchParams.get("fromName");
  const fromProductId = from?.startsWith("product:") ? from.slice("product:".length) : null;
  const originProductApi = useApi<{ product: { name: string } }>(
    fromProductId && !fromName ? `/inventory/products/${fromProductId}` : null
  );
  const productName = fromName || originProductApi.data?.product?.name;

  const { data, error, reload } = useApi<{ document: Doc }>(`/${base}/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [headerEdit, setHeaderEdit] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [reason, setReason] = useState("");
  // Sale cancel: set id → "release" when its measured parts come back as free cut pieces.
  const [setChoice, setSetChoice] = useState<Record<string, "keep" | "release">>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const backLink = useMemo(() => {
    if (fromProductId) {
      return {
        href: `/products/${fromProductId}#action-log`,
        label: productName ? `Back to ${productName} action log` : "Back to product action log",
      };
    }
    return { href: `/${base}`, label: isSale ? "Sale History" : "Purchase History" };
  }, [fromProductId, productName, base, isSale]);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!data) return <TableSkeleton rows={6} />;
  const d = data.document;
  const cancelled = d.status === "CANCELLED";
  const replaced = d.status === "REPLACED" || !!d.replacedBy;
  const measuredSets = isSale ? d.lines.flatMap((l) => (l.sets ?? []).filter((st) => st.measuredParts?.length)) : [];
  const hasMeasured = d.lines.some((l) => (l.pieces?.length ?? 0) > 0);
  const hasDiscount = Number(d.discount) > 0;

  function handleEdit() {
    // Rolls and sets stay as they are: prices and details only (2026-10-27).
    if (d.lines.some((l) => (l.sets?.length ?? 0) > 0 || (l.pieces?.length ?? 0) > 0)) {
      setVoiding(false);
      setHeaderEdit(true);
      return;
    }
    if (cart.lines.length > 0) {
      const ok = window.confirm(`Your cart already has ${cart.lines.length} item(s). Replace cart with this ${isSale ? "sale" : "purchase"} to edit?`);
      if (!ok) return;
    }
    const cartLines: CartLine[] = d.lines.map((l) => ({
      variationId: l.variationId,
      productId: l.productId || "",
      productName: l.productName,
      shortName: l.shortName,
      attributes: l.attributes,
      attributeUnits: l.attributeUnits,
      unit: l.unit,
      imageUrl: null,
      price: l.price,
      quantity: l.quantity,
      available: l.quantity,
      discount: Number(l.discount) > 0 ? l.discount : "",
      note: l.note ?? "",
    }));
    cart.loadDocument(
      mode,
      {
        documentId: d.id,
        number: d.number,
        revision: d.revision ?? 0,
        occurredAt: d.date,
        notes: d.notes,
        paymentMode: d.payment?.mode,
        amountPaid: d.payment?.amountPaid,
      },
      cartLines,
      d.partyId ? { id: d.partyId, name: d.partyName || "" } : null
    );
    router.push(isSale ? "/sales/checkout" : "/purchases/checkout");
  }

  async function doVoid() {
    setMsg("");
    if (reason.trim().length < 3) return setMsg("Give a reason (at least 3 characters).");
    setBusy(true);
    try {
      const releaseSetIds = Object.entries(setChoice).filter(([, c]) => c === "release").map(([k]) => k);
      await api(`/${base}/${id}/void`, { method: "POST", body: { reason: reason.trim(), ...(releaseSetIds.length ? { releaseSetIds } : {}) } });
      setSetChoice({});
      setVoiding(false);
      setReason("");
      await reload();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="no-print">
        <PageHeader
          back={backLink}
          title={d.number}
          badge={
            cancelled ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">Cancelled</span>
            ) : replaced ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Replaced</span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Completed{d.revision ? ` (R${d.revision})` : ""}</span>
            )
          }
          actions={
            <>
              <button className="btn-secondary" onClick={() => window.print()}><PrintIcon className="h-4 w-4" /> Print</button>
              {canEdit && !cancelled && !replaced && (
                <button className="btn-secondary text-brand-700" onClick={handleEdit}>Edit {isSale ? "sale" : "purchase"}</button>
              )}
              {canVoid && !cancelled && !replaced && (
                <button className="btn-secondary text-rose-600" onClick={() => setVoiding((v) => !v)}>Cancel {isSale ? "sale" : "purchase"}</button>
              )}
              <Link href={`/${base}/new`} className="btn-primary">{isSale ? "New Sale" : "New Purchase"}</Link>
            </>
          }
        />
      </div>

      {headerEdit && !cancelled && !replaced && <DocumentHeaderEdit mode={mode} doc={d} onClose={() => setHeaderEdit(false)} />}

      {voiding && !cancelled && !replaced && (
        <div className="no-print card border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="font-semibold text-rose-800">Cancel {d.number}?</p>
          <p className="mt-1 text-rose-900">
            The {isSale ? "sale" : "purchase"} stays on record as cancelled and its stock is {isSale ? "returned" : "taken back out"}. This cannot be undone.
            {!isSale && " A purchase whose stock was already sold cannot be cancelled."}
          </p>
          <label className="label mt-3" htmlFor="void-reason">Reason</label>
          <input id="void-reason" className="input" maxLength={300} placeholder="e.g. Customer returned the goods / entered twice" value={reason} onChange={(e) => setReason(e.target.value)} />
          {measuredSets.length > 0 && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-white p-3">
              <p className="font-semibold text-slate-900">Sets with measured parts</p>
              <p className="text-xs text-slate-600">Choose for each set: keep it together, or put its measured part back in stock as a free cut piece (the set comes back without it).</p>
              <ul className="mt-2 grid gap-2">
                {measuredSets.map((st) => {
                  const choice = setChoice[st.id] ?? "keep";
                  return (
                    <li key={st.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-semibold text-slate-800">{st.code}</div>
                        <div className="text-xs text-slate-500">{st.measuredParts!.map((p) => `${p.name} ${p.value}`).join(" · ")}</div>
                      </div>
                      <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={`${st.code} on cancel`}>
                        {(
                          [
                            ["keep", "Keep set together"],
                            ["release", "Release as cut piece"],
                          ] as const
                        ).map(([k, t]) => (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={choice === k}
                            onClick={() => setSetChoice((c) => ({ ...c, [st.id]: k }))}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${choice === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {isSale && hasMeasured && (
            <p className="mt-2 text-xs text-rose-900">
              Measured items: a whole bundle or cut piece that was sold comes back as that same piece (a sealed roll is sealed again); a length cut off a bundle or piece comes back as a new cut piece.
            </p>
          )}
          {msg && <p className="mt-2 text-rose-700" role="alert">{msg}</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn bg-rose-700 text-white hover:bg-rose-800" disabled={busy} onClick={doVoid}>{busy ? "Cancelling…" : "Confirm cancel"}</button>
            <button className="btn-secondary" onClick={() => setVoiding(false)}>Keep it</button>
          </div>
        </div>
      )}

      {replaced && d.replacedBy && (
        <div className="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          <b>Replaced by revision</b>{" "}
          <Link href={`/${base}/${d.replacedBy.id}`} className="font-semibold underline hover:text-amber-950">
            {d.replacedBy.number}
          </Link>
          {d.void?.at && <> on {dateTime(d.void.at)}</>}
          {d.void?.by && <> by {d.void.by}</>}
          {d.void?.reason && <>. Reason: {d.void.reason}</>}. Stock was replaced by the new revision.
        </div>
      )}

      {!!d.revision && d.revision > 0 && d.replaces && (
        <div className="card border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <b>Revised (R{d.revision})</b> of{" "}
              <Link href={`/${base}/${d.replaces.id}`} className="font-semibold underline hover:text-sky-950">
                {d.replaces.number}
              </Link>.
            </div>
            {d.revisions && d.revisions.length > 1 && (
              <button
                type="button"
                className="text-xs font-semibold text-sky-800 underline hover:text-sky-950"
                onClick={() => setShowRevisions((s) => !s)}
              >
                {showRevisions ? "Hide revision history" : `View revision history (${d.revisions.length})`}
              </button>
            )}
          </div>
          {showRevisions && d.revisions && (
            <div className="mt-3 overflow-x-auto rounded border border-sky-200 bg-white p-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="p-1">Rev</th>
                    <th className="p-1">Number</th>
                    <th className="p-1">Date</th>
                    <th className="p-1">Total</th>
                    <th className="p-1">Status</th>
                    <th className="p-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {d.revisions.map((rev) => (
                    <tr key={rev.id} className={rev.id === d.id ? "bg-sky-50 font-semibold" : ""}>
                      <td className="p-1">R{rev.revision}</td>
                      <td className="p-1">
                        {rev.id === d.id ? (
                          rev.number
                        ) : (
                          <Link href={`/${base}/${rev.id}`} className="text-brand-700 underline">{rev.number}</Link>
                        )}
                      </td>
                      <td className="p-1 text-slate-500">{dateTime(rev.date)}</td>
                      <td className="p-1">{money(rev.total)}</td>
                      <td className="p-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${rev.status === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : rev.status === "REPLACED" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>
                          {rev.status}
                        </span>
                      </td>
                      <td className="p-1 text-slate-600">{rev.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {cancelled && d.void && (
        <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="status">
          <b>Cancelled</b> on {dateTime(d.void.at)}{d.void.by ? ` by ${d.void.by}` : ""}. Reason: {d.void.reason}. Stock was reversed.
        </div>
      )}

      {/* Print-only heading: a plain A4 document (GST invoice layout is V3). */}
      <div className="print-only">
        <div className="flex items-start justify-between border-b border-slate-300 pb-3">
          <div>
            <div className="text-xl font-bold">RS Machinery</div>
            <div className="text-xs text-slate-600">{isSale ? "Sale bill" : "Purchase voucher"}{cancelled ? " — CANCELLED" : ""}</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">{d.number}</div>
            <div>{dateTime(d.date)}</div>
          </div>
        </div>
      </div>

      <section className="card print-area grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
        <Info label="Date">{dateTime(d.date)}</Info>
        <Info label={isSale ? "Customer" : "Supplier"}>
          {d.partyName && d.partyId ? (
            <Link className="no-print-link text-brand-700 hover:underline" href={`/${isSale ? "customers" : "suppliers"}/${d.partyId}`}>{d.partyName}</Link>
          ) : (
            isSale ? "Walk-in" : (d.partyName ?? "—")
          )}
        </Info>
        <Info label="Recorded by">{d.createdBy ?? "—"}</Info>
        <Info label="Total"><span className="text-lg font-bold">{money(d.total)}</span></Info>
        {d.payment && (
          <Info label="Payment">
            {d.payment.mode ? PAY_MODE[d.payment.mode] ?? d.payment.mode : "—"}
            {d.payment.status && <> · {PAY_STATUS[d.payment.status] ?? d.payment.status}</>}
            {d.payment.status === "PARTIAL" && d.payment.amountPaid && <> ({money(d.payment.amountPaid)} paid, {money(Number(d.total) - Number(d.payment.amountPaid))} due)</>}
          </Info>
        )}
        {d.notes && <div className="col-span-full"><Info label="Notes">{d.notes}</Info></div>}
      </section>

      <div className="card print-area overflow-x-auto lg:overflow-x-visible">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">{isSale ? "Price" : "Cost"}</th>
              {hasDiscount && <th className="text-right">Discount</th>}
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => {
              const attrsText = l.attributes && Object.keys(l.attributes).length > 0
                ? formatVariationAttributesString(l.attributes, l.attributeUnits)
                : "";
              return (
                <tr key={l.id} className={cancelled ? "text-slate-400 line-through decoration-rose-300" : ""}>
                  <td className="text-slate-400">{l.lineNo}</td>
                  <td>
                    <div className="font-medium text-slate-900">{l.productName}</div>
                    {attrsText && <div className="text-xs text-slate-500">{attrsText}</div>}
                    {!!l.pieces?.length && (
                      <div className="no-print mt-1 flex flex-wrap gap-1 text-[11px]">
                        {l.pieces.map((p, i) => (
                          <Link
                            key={`${p.id}-${i}`}
                            href={`/inventory/rolls/${p.id}`}
                            className={`rounded border px-1.5 py-0.5 hover:border-brand-400 ${p.action.endsWith("VOID") ? "border-slate-200 text-slate-400" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                            title={`${p.action}: ${p.before} → ${p.after}`}
                          >
                            {p.action === "SALE" ? `Piece ${p.before} → ${p.after}` : p.action.endsWith("VOID") ? "Piece returned" : "Piece"}
                          </Link>
                        ))}
                      </div>
                    )}
                    {/* V3.1: each set on a grouped line, part by part; set codes are never shown (owner, 2026-10-22). */}
                    {!!l.sets?.length && (
                      <ul className="mt-1 grid gap-1 text-[11px] text-slate-600">
                        {l.sets.map((s, i) => (
                          <li key={s.id}>
                            {(l.sets!.length > 1 || s.status === "CANCELLED") && (
                              <span className="font-semibold text-slate-500">
                                Set {i + 1}
                                {s.status === "CANCELLED" && <span className="no-print ml-1 font-normal text-rose-500">cancelled</span>}
                              </span>
                            )}
                            {s.contents ? (
                              <span className="block">{contentsText(s.contents)}</span>
                            ) : (
                              <span className="block">{s.name}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {l.note && <div className="text-xs italic text-slate-500">{l.note}</div>}
                  </td>
                  <td className="text-right">{l.quantity} {l.sets?.length ? (l.quantity === 1 ? "set" : "sets") : l.unit}</td>
                  <td className="text-right whitespace-nowrap">
                    {money(l.price)}
                    {l.rateUnit && l.rateUnit !== l.unit ? ` / ${l.rateUnit}` : ""}
                  </td>
                  {hasDiscount && <td className="text-right text-emerald-700">{Number(l.discount) > 0 ? `− ${money(l.discount)}` : ""}</td>}
                  <td className="text-right font-semibold">{money(l.lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {hasDiscount && (
              <>
                <tr>
                  <td colSpan={5} className="text-right text-slate-500">Gross</td>
                  <td className="text-right">{money(d.gross)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="text-right text-slate-500">Discount</td>
                  <td className="text-right text-emerald-700">− {money(d.discount)}</td>
                </tr>
              </>
            )}
            <tr>
              <td colSpan={hasDiscount ? 5 : 4} className="text-right font-semibold">Total</td>
              <td className="text-right text-lg font-bold">{money(d.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="print-only mt-8 text-right text-xs text-slate-500">Authorised signature ____________________</p>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}
