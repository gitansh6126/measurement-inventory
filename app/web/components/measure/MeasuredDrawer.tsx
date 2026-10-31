"use client";

import { isScrapLeftover, longEnough, planCuts, sortPieces, toMilli, type PieceLite, type PlanRequest } from "@rs-v31/shared/measure";
import { useEffect, useMemo, useState } from "react";
import { grossPaise, lineKey, useCart, type CartLine, type CartMode, type CartRoll } from "@/components/CartContext";
import { LengthField } from "@/components/measure/LengthField";
import { RateField } from "@/components/measure/RateField";
import { ProductThumb } from "@/components/ProductThumb";
import { money, variationLabel } from "@/lib/format";
import { KIND_CLASS, KIND_LABEL, baseLabel, fmtLen, fmtSellRate, kindPhrase, metaOf, rateLabel, rollWord, type PieceView, type ProductPieces } from "@/lib/measure";
import { PieceColumns, dayMonth } from "@/components/measure/PieceColumns";
import type { StockProduct, StockVariation } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useEntryUnits } from "@/lib/useEntryUnits";
import { useSupplierRates } from "@/lib/useSupplierRates";
import { useCan } from "@/components/MeContext";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { CollapseIcon, ExpandIcon } from "@/components/icons";
import { SupplierRateList } from "@/components/vendor/SupplierRateList";
import { WarehouseStockChips } from "@/components/cart/TakeFromPopup";
import { OptionButtons } from "@/components/cart/OptionButtons";
import { useLengthView } from "@/lib/lengthView";

// Measured products in the sale / purchase drawer (wireframes W12, W14–W15, W17).
//
// Sale: the length is typed in any length unit; a live cut plan pre-selects the first piece in
// DM-5 order (Cut → Open → Closed, smallest first) that is long enough by itself, after what
// other cart lines of the same variation already take. Owner design 2026-10-16
// (v2\docs\measurement\measurement-design.html): every piece shows in Cut / Open / Closed columns
// to choose from (shorter ones can be sold whole); a cut piece that fits and other sizes are
// suggested only when they apply. Every sale line comes from one piece; pieces are never joined. With no
// piece long enough the line is added as a backorder. Roll codes are not shown. The server
// re-plans at checkout.
//
// Purchase: one row per physical roll, each length typed; the line quantity is their sum.

const lite = (p: PieceView): PieceLite => ({ id: p.id, code: p.code, variationId: p.variationId, kind: p.kind, remainingMilli: toMilli(p.remainingLength), receivedAt: p.receivedAt });
const round3 = (n: number) => Math.round(n * 1000) / 1000;
// Owner 2026-10-28: hide the "Cutting X from … / Leaves Y / Sell entire piece" line and the
// "Other sizes" suggestions for now (kept for later use). Set true to show them again.
const SHOW_CUT_HINTS = false;

export function MeasuredDrawer({ product, mode, onClose, edit }: { product: StockProduct; mode: CartMode; onClose: () => void; edit?: { index: number; line: CartLine } }) {
  useLengthView();
  const cart = useCart();
  const canViewVendor = useCan("vendor_pricing.view");
  const canManageVendor = useCan("vendor_pricing.manage");
  const isSale = mode === "sale";
  const meta = metaOf({ ...(product.measure ?? { lengthUnit: "m" }), lengthUnit: product.measure?.lengthUnit ?? "m" });
  const unit = baseLabel(meta.lengthUnit);
  // Rates are per the rate unit: per m, or per ft on a feet + inches product (lengths in inches).
  const rUnit = rateLabel(meta.lengthUnit)!;
  // Remembered entry units, kept apart for sales and purchases.
  const units = useEntryUnits(isSale ? "sale" : "purchase");
  const lenPref = { preferredUnit: units.lengthUnit(meta.lengthUnit), onUnitChange: (u: string) => units.setLengthUnit(meta.lengthUnit, u) };
  const ratePref = { preferredUnit: units.rateUnit(meta.lengthUnit), onUnitChange: (u: string) => units.setRateUnit(meta.lengthUnit, u) };
  const active = useMemo(() => product.variations.filter((v) => v.active), [product]);
  const activeVarIds = useMemo(() => active.map((v) => v.id), [active]);
  const supplierId = !isSale && cart.party?.mode === "purchase" ? cart.party.id : null;
  const { suggestions, reload: reloadRates } = useSupplierRates(!isSale ? activeVarIds : [], supplierId);

  const [showStock, setShowStock] = useState(false);
  const pieces = useApi<ProductPieces>(isSale || showStock ? `/measure/products/${product.id}/pieces` : null);

  // One row of option buttons per attribute, like the single-product page. Nothing is picked up
  // front (owner 2026-10-27) unless the line is being edited or there is only one variation.
  const optionAttrs = useMemo(() => product.attributes.filter((a) => active.some((v) => v.attributes[a.name])), [product.attributes, active]);
  const [pick, setPick] = useState<Record<string, string>>(() => {
    const start = edit ? active.find((v) => v.id === edit.line.variationId) : active.length === 1 ? active[0] : undefined;
    return start ? { ...start.attributes } : {};
  });
  const [flatId, setFlatId] = useState<string | null>(edit?.line.variationId ?? (active.length === 1 ? active[0].id : null));
  const variationId = optionAttrs.length
    ? active.find((v) => optionAttrs.every((a) => (v.attributes[a.name] ?? "") === (pick[a.name] ?? "")))?.id ?? null
    : flatId;
  const setVariationId = (id: string) => {
    const v = active.find((x) => x.id === id);
    if (v) setPick({ ...v.attributes });
    setFlatId(id);
  };
  const chosen: StockVariation | undefined = active.find((v) => v.id === variationId);
  const [length, setLength] = useState<number>(isSale && edit ? edit.line.quantity : NaN);
  const [price, setPrice] = useState(edit ? String(Number(edit.line.price)) : "");
  const [pieceId, setPieceId] = useState<string | null>(edit?.line.measure?.pieceId ?? null);
  const [leftover, setLeftover] = useState<"keep" | "writeoff" | null>(edit?.line.measure?.writeOffLeftover ? "writeoff" : null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);

  const sug = chosen ? suggestions.get(chosen.id) : undefined;

  const defaultRoll = chosen?.defaultRollLength ?? product.measure?.defaultRollLength ?? NaN;
  const [rolls, setRolls] = useState<CartRoll[]>(() => edit?.line.measure?.rolls?.map((r) => ({ ...r })) ?? []);
  useEffect(() => {
    if (!isSale && chosen && !rolls.length) setRolls([{ length: defaultRoll }]);
  }, [chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // No price prefill (owner, 2026-10-20): the rate is typed or picked from a price chip.
  // A new variation starts empty so another variation's rate is never carried over.
  useEffect(() => {
    if (!chosen || (edit && chosen.id === edit.line.variationId)) return;
    setPrice("");
  }, [chosen?.id, edit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const L = (n: number) => fmtLen(n, meta);
  const priceOk = /^\d{1,10}$/.test(price.trim());
  const varName = (v: { attributes: Record<string, string>; shortName: string }) => variationLabel(v, product.attributes) || v.shortName;

  // ---- Sale planning (browser preview of the server's planCuts) ----
  const allPieces = useMemo(() => (pieces.data?.variations ?? []).flatMap((v) => v.pieces.map(lite)), [pieces.data]);
  // Other cart lines of this product take their lengths first, so two lines never claim the same piece.
  const others: PlanRequest[] = useMemo(
    () =>
      cart.mode === "sale"
        ? cart.lines
            .filter((l, i) => l.measure && l.productId === product.id && (!edit || i !== edit.index))
            .map((l) => ({ key: lineKey(l), variationId: l.variationId, lengthMilli: toMilli(l.quantity), pieceId: l.measure?.pieceId ?? null }))
        : [],
    [cart.lines, cart.mode, product.id, edit],
  );
  // What is left on each piece after the other lines.
  const leftPieces = useMemo(() => {
    const { cuts } = planCuts(others, allPieces);
    const taken = new Map<string, number>();
    for (const c of cuts) taken.set(c.pieceId, (taken.get(c.pieceId) ?? 0) + c.lengthMilli);
    return allPieces.map((p) => ({ ...p, remainingMilli: p.remainingMilli - (taken.get(p.id) ?? 0) })).filter((p) => p.remainingMilli > 0);
  }, [others, allPieces]);

  const need = Number.isFinite(length) && length > 0 ? toMilli(length) : 0;
  const own = leftPieces.filter((p) => p.variationId === variationId);
  const fits = need ? longEnough(own, need) : sortPieces(own);
  const picked = pieceId ? own.find((p) => p.id === pieceId) : undefined;
  const plan = need ? (picked && picked.remainingMilli >= need ? picked : !pieceId || !picked ? fits[0] : undefined) : undefined;
  const leaves = plan ? plan.remainingMilli - need : 0;
  const scrap = plan ? isScrapLeftover(leaves, meta.scrapBelow ? toMilli(meta.scrapBelow) : null) : false;
  const longest = own.reduce((m, p) => Math.max(m, p.remainingMilli), 0);
  const otherVars = (pieces.data?.variations ?? []).filter((v) => v.active && v.id !== variationId);
  const ownTotal = own.reduce((s, p) => s + p.remainingMilli, 0);
  // A cut piece long enough when the plan uses a roll (owner design 2026-10-16).
  const cutFit = plan && plan.kind !== "CUT" ? fits.find((p) => p.kind === "CUT") : undefined;
  const usePiece = (p: PieceLite) => {
    setPieceId(p.id);
    setLength(p.remainingMilli / 1000);
  };

  // A chosen piece that no longer fits is dropped back to the automatic choice.
  useEffect(() => {
    if (pieceId && need && picked && picked.remainingMilli < need) setPieceId(null);
  }, [need]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setLeftover(null), [plan?.id, leaves]);

  // ---- Purchase rolls ----
  const rollTotal = round3(rolls.reduce((s, r) => s + (Number.isFinite(r.length) && r.length > 0 ? r.length : 0), 0));
  // A new roll copies the previous one's length. The warehouse is chosen when the purchase is
  // received (checkout "Receive into" / order completion), not per roll here.
  const addRoll = () => setRolls((r) => [...r, { length: r[r.length - 1]?.length ?? defaultRoll }]);
  const patchRoll = (i: number, p: Partial<CartRoll>) => setRolls((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  // "No. of rolls" sets the row count: new rows copy the last length, extra rows drop from the end.
  const MAX_ROLLS = 500;
  const [rollCount, setRollCount] = useState("");
  useEffect(() => setRollCount(String(rolls.length || "")), [rolls.length]);
  const resizeRolls = (text: string) => {
    setRollCount(text);
    const n = Number(text);
    if (!/^\d+$/.test(text) || n < 1 || n > MAX_ROLLS) return;
    setRolls((r) => (n <= r.length ? r.slice(0, n) : [...r, ...Array.from({ length: n - r.length }, () => ({ length: r[r.length - 1]?.length ?? defaultRoll }))]));
  };

  const qty = isSale ? round3(length) : rollTotal;
  const subtotal = priceOk && qty > 0 ? grossPaise({ quantity: qty, price: price.trim(), measure: meta }) : 0;

  function commit() {
    setError("");
    if (!chosen) return setError("Choose a variation");
    if (!priceOk) return setError("Enter a whole rupee rate");
    // Several lines of one Measured variation are allowed (W16, migration 0021): each is cut
    // from its own piece, planned together with the other lines of this product.
    const attrUnits: Record<string, string> = {};
    for (const a of product.attributes) if (!a.isQuality && a.unit) attrUnits[a.name] = a.unit;
    let measure: CartLine["measure"];
    if (isSale) {
      if (!need) return setError("Enter the length to sell");
      if (!plan) {
        // Customer shortage / backorder line
        measure = { ...meta, pieceId: null, pieceCode: null, pieceKind: null, isShortage: true };
      } else {
        if (scrap && !leftover) return setError("Choose what to do with the leftover");
        measure = { ...meta, pieceId: plan.id, pieceCode: plan.code, pieceKind: plan.kind, writeOffLeftover: scrap && leftover === "writeoff" };
      }
    } else {
      if (!rolls.length || rolls.some((r) => !Number.isFinite(r.length) || r.length <= 0)) return setError(`Enter the length of every ${rollWord(meta)}`);
      measure = { ...meta, rolls: rolls.map((r) => ({ length: round3(r.length) })) };
    }
    const line: CartLine = {
      lineId: edit?.line.lineId,
      variationId: chosen.id,
      productId: product.id,
      productName: product.name,
      shortName: chosen.shortName,
      attributes: chosen.attributes,
      attributeUnits: attrUnits,
      unit,
      imageUrl: chosen.imageUrl ?? product.imageUrl,
      price: price.trim(),
      quantity: qty,
      available: chosen.quantity,
      measure,
    };
    if (edit) {
      cart.replace(edit.index, line);
      return onClose();
    }
    const blocked = cart.add(mode, line);
    if (blocked) return setError(blocked);
    onClose();
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex ${
        expanded
          ? "p-0 items-stretch justify-stretch"
          : "items-end justify-center sm:items-center sm:p-4"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={`${isSale ? "Add sale" : "Add purchase"}: ${product.name}`}
    >
      <button
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`relative z-10 flex flex-col w-full bg-white shadow-2xl overflow-hidden transition-all duration-200 ${
          expanded
            ? "h-full w-full max-w-none max-h-none rounded-none"
            : "h-[94vh] sm:h-[88vh] max-h-[94vh] sm:max-h-[88vh] w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl rounded-t-2xl sm:rounded-2xl"
        }`}
      >
        {/* Sticky Header - Always visible */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-3.5 sm:px-6">
          <ProductThumb
            src={chosen?.imageUrl ?? product.imageUrl}
            name={product.name}
            className="h-14 w-14 shrink-0 rounded-lg text-[9px] border border-slate-200 object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {edit ? "Edit line" : isSale ? "Add sale" : "Add purchase"}
            </div>
            <h2 className="text-lg font-bold text-slate-900 truncate">{product.name}</h2>
            {chosen && <div className="text-xs text-slate-500 truncate">{varName(chosen)}</div>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 cursor-pointer"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? "Restore product popup size" : "Expand product popup to full size"}
              aria-expanded={expanded}
              title={expanded ? "Restore size" : "Full size"}
            >
              {expanded ? <CollapseIcon className="h-4 w-4" /> : <ExpandIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{expanded ? "Restore" : "Full size"}</span>
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-90 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        {/* Scrollable Body Container */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="mb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="label">Variation</div>
              <button
                type="button"
                className={`mb-1 rounded-full border px-3 py-0.5 text-xs font-semibold transition-colors cursor-pointer ${showStock ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-600 hover:border-brand-500 hover:text-brand-600"}`}
                aria-expanded={showStock}
                onClick={() => setShowStock((x) => !x)}
              >
                {showStock ? "Hide stock" : `Check Stock (${active.length})`}
              </button>
            </div>
            {showStock && (
              <div className="mb-3 max-h-[40vh] overflow-auto rounded-lg border border-slate-200">
                <table className="table table-stack min-w-full">
                  <thead className="sticky top-0 z-10 bg-slate-50 shadow-xs">
                    <tr>
                      <th className="bg-slate-50">Variation</th>
                      <th className="bg-slate-50 text-right">{isSale ? `Min – Selling / ${rUnit}` : `Supplier rate / Cost per ${rUnit}`}</th>
                      <th className="bg-slate-50 text-right">In stock</th>
                      <th className="bg-slate-50 text-right">{KIND_LABEL.CUT} · {KIND_LABEL.OPEN} · {KIND_LABEL.CLOSED}</th>
                      <th className="bg-slate-50 text-right">Longest{isSale && cart.mode === "sale" ? " (after cart)" : ""}</th>
                      <th className="bg-slate-50 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {active.map((v) => {
                      // Sale: what is left after the other cart lines; purchase: pieces as they are.
                      const vp = isSale ? leftPieces.filter((p) => p.variationId === v.id) : allPieces.filter((p) => p.variationId === v.id);
                      const count = (k: string) => vp.filter((p) => p.kind === k).length;
                      const max = vp.reduce((m, p) => Math.max(m, p.remainingMilli), 0);
                      const vSug = suggestions.get(v.id);
                      const isSel = v.id === variationId;
                      return (
                        <tr key={v.id} className={`cursor-pointer transition-colors hover:bg-brand-50/50 ${isSel ? "bg-brand-50 font-medium" : ""}`} onClick={() => { setVariationId(v.id); setPieceId(null); setError(""); }}>
                          <td className="whitespace-nowrap text-slate-800">{varName(v)}</td>
                          <td className="whitespace-nowrap text-right text-sm">
                            {isSale ? (
                              <span className="font-semibold text-brand-700">
                                {fmtSellRate(meta.lengthUnit, v.minSalePrice, v.salePrice, "Sell: ")}
                              </span>
                            ) : vSug?.supplierRate ? (
                              <>
                                <b>{money(vSug.supplierRate)}</b>
                                <span className="block text-[10px] text-sky-600">{cart.party?.name}</span>
                              </>
                            ) : vSug?.cheapest ? (
                              <>
                                <b>{money(vSug.cheapest.rate)}</b>
                                <span className="block text-[10px] text-slate-500">
                                  {vSug.rates.length > 1 ? `Best: ${vSug.cheapest.supplierName} · ${vSug.rates.length} suppliers` : vSug.cheapest.supplierName}
                                </span>
                              </>
                            ) : (
                              <span className={Number(v.purchaseCost) > 0 ? "font-semibold" : "text-slate-400"}>{Number(v.purchaseCost) > 0 ? money(v.purchaseCost) : "—"}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap text-right">
                            <b className={v.quantity > 0 ? "text-emerald-700" : "text-rose-600"}>{L(v.quantity)}</b>
                            <div className="mt-0.5"><WarehouseStockChips rows={v.byWarehouse} /></div>
                          </td>
                          <td className="whitespace-nowrap text-right text-xs text-slate-600">
                            {pieces.data ? `${count("CUT")} · ${count("OPEN")} · ${count("CLOSED")}` : "…"}
                          </td>
                          <td className="whitespace-nowrap text-right text-sm">{pieces.data ? (max ? L(max / 1000) : <span className="text-slate-400">—</span>) : "…"}</td>
                          <td className="text-center">
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${isSel ? "bg-brand-600 text-white" : "border border-slate-300 text-slate-700"}`}>{isSel ? "Selected ✓" : "Select"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {optionAttrs.length ? (
              <>
                <OptionButtons
                  attributes={optionAttrs}
                  active={active}
                  picks={pick}
                  onChange={(name, value) => {
                    // Tapping the picked value again clears it.
                    setPick((p) => {
                      const next = { ...p };
                      if (next[name] === value) delete next[name];
                      else next[name] = value;
                      return next;
                    });
                    setPieceId(null);
                    setError("");
                  }}
                />
                <div className="mt-2 text-xs">
                  {chosen ? (
                    <span className="text-slate-600">
                      Selected: <b className="text-slate-800">{varName(chosen)}</b>
                      {isSale && pieces.data && (() => {
                        const vp = pieces.data.variations.find((x) => x.id === chosen.id)?.pieces ?? [];
                        return <span className={vp.length ? "text-emerald-700" : "text-rose-600"}> · {vp.length ? `${L(vp.reduce((s, p) => s + p.remainingLength, 0))} in stock` : "no stock"}</span>;
                      })()}
                    </span>
                  ) : (
                    <span className="text-amber-700">Choose {optionAttrs.filter((a) => !pick[a.name]).map((a) => a.name).join(", ") || "another combination"}</span>
                  )}
                </div>
              </>
            ) : (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Variation">
              {active.map((v) => {
                const vp = isSale ? pieces.data?.variations.find((x) => x.id === v.id)?.pieces : undefined;
                const n = vp ? vp.length : null;
                const vTotal = vp ? vp.reduce((s, p) => s + p.remainingLength, 0) : 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={variationId === v.id}
                    onClick={() => {
                      setVariationId(v.id);
                      setPieceId(null);
                      setError("");
                    }}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-150 cursor-pointer ${
                      variationId === v.id ? "border-brand-600 bg-brand-600 text-white shadow-xs" : "border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:bg-brand-50/50"
                    }`}
                  >
                    {varName(v)}
                    {n !== null && <span className="ml-1 text-xs opacity-80">· {n ? L(vTotal) : "no stock"}</span>}
                  </button>
                );
              })}
            </div>
            )}
          </div>

          {chosen && isSale && (
            <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-sm border border-slate-200/60">
              <span className="font-semibold text-brand-700">
                {fmtSellRate(meta.lengthUnit, chosen.minSalePrice, chosen.salePrice, "Sell: ")}
              </span>
            </div>
          )}

          {chosen && isSale && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <LengthField id="sale-length" base={meta.lengthUnit} decimals={meta.decimals} value={Number.isFinite(length) ? length : null} onChange={setLength} autoFocus={!edit} {...lenPref} />
                </div>
                <div>
                  <RateField id="sale-rate" label={`Rate ₹ / ${rUnit}`} unit={meta.lengthUnit} value={price} onChange={(x) => { setPrice(x); }} {...ratePref} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-medium text-slate-500">Price guide:</span>
                    {Number(chosen.minSalePrice) > 0 && (
                      <button
                        type="button"
                        className={`rounded-full border px-2 py-0.5 transition-colors cursor-pointer ${
                          price === String(Math.round(Number(chosen.minSalePrice)))
                            ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                            : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                        onClick={() => {
                          setPrice(String(Math.round(Number(chosen.minSalePrice))));
                        }}
                        title="Use minimum selling price"
                      >
                        Min {money(chosen.minSalePrice)}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`rounded-full border px-2 py-0.5 transition-colors cursor-pointer ${
                        price === String(Math.round(Number(chosen.salePrice)))
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                          : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => {
                        setPrice(String(Math.round(Number(chosen.salePrice))));
                      }}
                      title="Use standard selling price"
                    >
                      Selling {money(chosen.salePrice)}
                    </button>
                  </div>
                </div>
              </div>

              {(SHOW_CUT_HINTS || !(pieces.data && need && plan && plan.kind !== "CLOSED" && !scrap)) && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {!pieces.data ? (
                  <p className="text-sm text-slate-500">{pieces.error || "Loading stock…"}</p>
                ) : !need ? (
                  <p className="text-xs text-slate-500">
                    {own.length ? (
                      <>
                        Enter a length to check stock. Longest piece in stock is <b>{L(longest / 1000)}</b> (total {L(ownTotal / 1000)} across {own.length} {own.length === 1 ? "piece" : "pieces"}).
                      </>
                    ) : (
                      `No ${varName(chosen)} ${rollWord(meta, 2)} in stock.`
                    )}
                  </p>
                ) : plan ? (
                  <>
                    {SHOW_CUT_HINTS && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_CLASS[plan.kind]}`}>{KIND_LABEL[plan.kind]}</span>
                        <span className="font-bold text-slate-900">
                          Cutting {L(need / 1000)} from {kindPhrase(plan.kind, meta.rollName)} ({L(plan.remainingMilli / 1000)})
                        </span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800">{leaves > 0 ? `Leaves ${L(leaves / 1000)}` : "Uses the whole piece"}</span>
                      </div>
                      {leaves > 0 && (
                        <button type="button" className="btn-secondary !py-1 !text-xs font-medium" onClick={() => usePiece(plan)}>
                          Sell entire piece ({L(plan.remainingMilli / 1000)})
                        </button>
                      )}
                    </div>
                    )}
                    {plan.kind === "CLOSED" && <p className="mt-1 text-[11px] text-slate-500">The sealed {rollWord(meta)} is opened by this sale.</p>}
                    {scrap && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="alert">
                        <span>
                          Remaining {L(leaves / 1000)} is below the scrap limit ({L(meta.scrapBelow ?? 0)}).
                        </span>
                        <div className="flex gap-1.5">
                          <button type="button" className={`btn-secondary !px-2 !py-0.5 !text-xs ${leftover === "writeoff" ? "!border-amber-600 !bg-amber-100 font-bold" : ""}`} onClick={() => setLeftover("writeoff")}>
                            Write off
                          </button>
                          <button type="button" className={`btn-secondary !px-2 !py-0.5 !text-xs ${leftover === "keep" ? "!border-amber-600 !bg-amber-100 font-bold" : ""}`} onClick={() => setLeftover("keep")}>
                            Keep piece
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800" role="alert">
                    <div className="font-bold">
                      Shortage: customer wants {L(need / 1000)}, but the longest piece is {L(longest / 1000)}.
                    </div>
                    <p className="mt-0.5 text-[11px] text-rose-700">
                      Total across pieces is {L(ownTotal / 1000)}. Pieces are never joined; add the line as a backorder and order a new {rollWord(meta)}.
                    </p>
                  </div>
                )}
              </div>
              )}

              {/* Suggestions (owner design 2026-10-16): only when they apply. */}
              {need > 0 && cutFit && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs">
                  <span className="text-amber-900">
                    💡 <b>Cut piece available:</b> a {L(cutFit.remainingMilli / 1000)} cut piece is in stock.
                  </span>
                  <button type="button" className="btn border border-amber-400 bg-white !px-2 !py-0.5 !text-xs font-semibold text-amber-900 hover:bg-amber-100" onClick={() => setPieceId(cutFit.id)}>
                    Use cut piece ({L(cutFit.remainingMilli / 1000)})
                  </button>
                </div>
              )}
              {SHOW_CUT_HINTS && need > 0 && otherVars.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-500">Other sizes:</span>
                  {otherVars.map((v) => {
                    const max = leftPieces.filter((p) => p.variationId === v.id).reduce((m, p) => Math.max(m, p.remainingMilli), 0);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-brand-500"
                        onClick={() => {
                          setVariationId(v.id);
                          setPieceId(null);
                          setError("");
                        }}
                      >
                        {varName(v)} (longest {L(max / 1000)})
                      </button>
                    );
                  })}
                </div>
              )}

              {pieces.data && own.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Choose stock piece</span>
                    <span className="text-xs text-slate-500">{need ? "Click a piece to cut from it, or sell a shorter one whole" : "Pieces in stock"}</span>
                  </div>
                  <PieceColumns
                    pieces={own}
                    lengthOf={(p) => p.remainingMilli / 1000}
                    meta={meta}
                    renderPiece={(p) => {
                      const selected = plan?.id === p.id;
                      const fitsNeed = need > 0 && p.remainingMilli >= need;
                      const tone = selected
                        ? "border-brand-600 ring-2 ring-brand-500 bg-brand-50/40"
                        : fitsNeed || !need
                          ? "border-slate-300 bg-white hover:border-brand-500 hover:bg-brand-50/20"
                          : "border-slate-200 bg-slate-50 opacity-70 hover:opacity-100";
                      // The whole box chooses a piece that fits (owner 2026-10-28: no "Choose" button).
                      const choosable = fitsNeed && !selected;
                      return (
                        <div
                          key={p.id}
                          className={`rounded-lg border p-2 transition ${tone} ${choosable ? "cursor-pointer" : ""}`}
                          {...(choosable && {
                            role: "button",
                            tabIndex: 0,
                            "aria-label": `Choose ${L(p.remainingMilli / 1000)} piece`,
                            onClick: () => setPieceId(p.id),
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setPieceId(p.id);
                              }
                            },
                          })}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-sm font-bold text-slate-900">{L(p.remainingMilli / 1000)}</span>
                            {selected ? (
                              <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">✓ Selected</span>
                            ) : fitsNeed ? null : (
                              <button type="button" className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100" title="Sell the whole piece" onClick={() => usePiece(p)}>
                                Sell {L(p.remainingMilli / 1000)}
                              </button>
                            )}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                            <span>
                              {!need ? kindPhrase(p.kind, meta.rollName) : fitsNeed ? `Leaves ${L((p.remainingMilli - need) / 1000)}` : <span className="font-medium text-rose-600">Short by {L((need - p.remainingMilli) / 1000)}</span>}
                            </span>
                            <span className="text-slate-400">{dayMonth(p.receivedAt)}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <p className="mt-2 text-xs text-slate-500">Choosing a piece only changes this cart line; nothing is cut until checkout.</p>
                </div>
              )}
            </>
          )}

          {chosen && !isSale && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-64">
                  <RateField
                    id="pur-rate"
                    label={`Cost ₹ / ${rUnit}`}
                    unit={meta.lengthUnit}
                    value={price}
                    onChange={(v) => {
                      setPrice(v);
                    }}
                    {...ratePref}
                  />
                </div>
                <div className="w-36">
                  <label className="label" htmlFor="pur-roll-count">No. of {rollWord(meta, 2)}</label>
                  <input
                    id="pur-roll-count"
                    className="input h-10 text-right font-semibold"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_ROLLS}
                    step={1}
                    value={rollCount}
                    onChange={(e) => resizeRolls(e.target.value.trim())}
                    onBlur={() => setRollCount(String(rolls.length))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <p className="text-xs text-slate-500">Type the length printed on each {rollWord(meta)}&apos;s tag. Enter adds the next {rollWord(meta)} with the same length.</p>
              </div>

              {canViewVendor && (
                <SupplierRateList
                  suggestion={sug}
                  supplierId={supplierId}
                  supplierName={cart.party?.name}
                  defaultCost={chosen.purchaseCost}
                  per={` / ${rUnit}`}
                  price={price}
                  onPick={setPrice}
                  onEdit={canManageVendor ? () => setShowVendorModal(true) : undefined}
                />
              )}

              {/* Purchase rolls table - properly sized container with sticky headers */}
              <div className="overflow-auto max-h-[50vh] rounded-lg border border-slate-200 bg-white shadow-xs">
                <table className="table min-w-full">
                  <thead className="sticky top-0 z-10 bg-slate-50 shadow-xs">
                    <tr>
                      <th className="bg-slate-50">#</th>
                      <th className="bg-slate-50">Length</th>
                      <th className="bg-slate-50 text-right">Amount</th>
                      <th className="bg-slate-50" aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rolls.map((r, i) => (
                      <tr key={i}>
                        <td className="text-slate-500 font-mono text-xs">{i + 1}</td>
                        <td>
                          <LengthField compact base={meta.lengthUnit} decimals={meta.decimals} label={`${rollWord(meta)} ${i + 1} length`} value={Number.isFinite(r.length) ? r.length : null} onChange={(v) => patchRoll(i, { length: v })} onEnter={addRoll} autoFocus={i === rolls.length - 1} {...lenPref} />
                        </td>
                        <td className="whitespace-nowrap text-right font-medium text-slate-800">{priceOk && Number.isFinite(r.length) && r.length > 0 ? money(grossPaise({ quantity: round3(r.length), price: price.trim(), measure: meta }) / 100) : "—"}</td>
                        <td className="text-center">
                          <button type="button" className="text-slate-400 hover:text-rose-600 disabled:opacity-30 cursor-pointer p-1" disabled={rolls.length === 1} aria-label={`Remove ${rollWord(meta)} ${i + 1}`} onClick={() => setRolls((x) => x.filter((_, j) => j !== i))}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" className="btn-secondary" onClick={addRoll}>+ Add {rollWord(meta)}</button>
                <span className="text-sm text-slate-600">{rolls.length} {rollWord(meta, rolls.length)} · {L(rollTotal)}</span>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p>}
        </div>

        {/* Always Visible Sticky Footer */}
        <div className="shrink-0 border-t border-slate-200 bg-slate-50/95 px-5 py-3 sm:px-6 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-500">
            {subtotal > 0 ? (
              <>Amount <b className="text-lg font-bold text-slate-900">{money(subtotal / 100)}</b></>
            ) : (
              <span>Ready to add to cart</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className={`btn text-white transition-all duration-150 active:scale-[0.98] motion-reduce:transform-none ${isSale ? (plan ? "bg-brand-600 hover:bg-brand-700 hover:shadow-md focus-visible:ring-brand-500" : "bg-amber-600 hover:bg-amber-700 hover:shadow-md focus-visible:ring-amber-500") : "bg-slate-900 hover:bg-slate-800 hover:shadow-md focus-visible:ring-slate-700"}`}
              disabled={!chosen || !qty || (isSale && plan && scrap && !leftover)}
              onClick={commit}
            >
              {edit
                ? "Update line"
                : isSale
                ? need
                  ? plan
                    ? `Add ${L(need / 1000)} to cart`
                    : `Add ${L(need / 1000)} as backorder`
                  : "Add to cart"
                : `Add ${rolls.length} ${rollWord(meta, rolls.length)} to cart`}
            </button>
          </div>
        </div>
      </div>

      {showVendorModal && chosen && (
        <VendorPricingModal
          productId={product.id}
          variationId={chosen.id}
          onClose={() => setShowVendorModal(false)}
          onSaved={() => {
            void reloadRates();
          }}
        />
      )}
    </div>
  );
}
