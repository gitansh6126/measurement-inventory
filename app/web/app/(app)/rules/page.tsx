"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  BoxesIcon,
  ChevronIcon,
  CogIcon,
  GroupedIcon,
  LayersIcon,
  PackageIcon,
  PriceIcon,
  RupeeIcon,
  SearchIcon,
  ShiftIcon,
  SlidersIcon,
  TagIcon,
  WarnIcon,
} from "@/components/icons";
import { PageHeader, SearchInput, Segmented } from "@/components/ui";

type SectionTab = "all" | "bundles" | "measured" | "velocity" | "pricing" | "orders";

export default function BusinessLogicPage() {
  const [activeTab, setActiveTab] = useState<SectionTab>("all");
  const [search, setSearch] = useState("");
  const [expandedDiagram, setExpandedDiagram] = useState<string | null>("bundles-stock");

  const toggleDiagram = (id: string) => {
    setExpandedDiagram((curr) => (curr === id ? null : id));
  };

  const matchesSearch = (text: string) => {
    if (!search.trim()) return true;
    return text.toLowerCase().includes(search.toLowerCase().trim());
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-20">
      {/* Page Header */}
      <PageHeader
        title="Business Logic & Rules Engine"
        subtitle="Visual, interactive guide to how RS Inventory calculates bundle stock, handles cuts, prices items, and ranks products."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/settings" className="btn-secondary text-xs">
              <CogIcon className="h-3.5 w-3.5" /> Company Settings
            </Link>
            <Link href="/glossary" className="btn-secondary text-xs">
              Glossary
            </Link>
          </div>
        }
      />

      {/* Top Banner / Search & Filter */}
      <div className="card space-y-4 p-5 sm:p-6 bg-gradient-to-r from-slate-900 via-brand-950 to-slate-900 text-white shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-brand-500/20 px-2.5 py-0.5 text-xs font-semibold text-brand-300 ring-1 ring-brand-400/30">
                System Intelligence
              </span>
              <span className="text-xs text-slate-300">Live Production Engine Rules</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-white sm:text-xl">
              Transparent Operations &amp; Automated Calculations
            </h2>
            <p className="text-xs text-slate-300 sm:text-sm">
              Every formula, shortage guard, bundle reallocation, and sorting rule documented with visual workflows.
            </p>
          </div>

          <div className="w-full sm:w-72">
            <div className="relative">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search rules (e.g. bundle, cut, 30-day)..."
                className="w-full bg-white/10 text-white placeholder-slate-400 border-white/20 focus:bg-white focus:text-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
          {[
            { id: "all", label: "All Rules", icon: LayersIcon },
            { id: "bundles", label: "Bundle & Set Stock", icon: GroupedIcon },
            { id: "measured", label: "Measured Cuts & Reels", icon: BoxesIcon },
            { id: "velocity", label: "High-Moving (30D)", icon: SlidersIcon },
            { id: "pricing", label: "Pricing & Margins", icon: RupeeIcon },
            { id: "orders", label: "Orders & Reversals", icon: PackageIcon },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as SectionTab)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? "bg-brand-500 text-white shadow"
                    : "bg-white/10 text-slate-200 hover:bg-white/20 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: BUNDLE & GROUPED SET STOCK LOGIC (CENTERPIECE)                  */}
      {/* ========================================================================= */}
      {(activeTab === "all" || activeTab === "bundles") &&
        matchesSearch("bundle set grouped hoist chain free stock allocated in-place shortening lengthening") && (
          <section className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 font-bold text-sm">
                    🧩
                  </span>
                  <h3 className="text-lg font-bold text-slate-900">
                    Bundle &amp; Grouped Set Stock Logic
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  How assembled sets (e.g. Electric Hoists + Chain + Hook) manage component inventory, in-place cuts, and backorders.
                </p>
              </div>
              <Link href="/products?type=grouped" className="text-xs font-semibold text-brand-600 hover:underline">
                View Sets in Catalog &rarr;
              </Link>
            </div>

            {/* Architecture Diagram Card */}
            <div className="card overflow-hidden border-indigo-100 p-5 shadow-sm sm:p-6 bg-gradient-to-b from-white to-indigo-50/30">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-xl space-y-2">
                  <span className="inline-flex items-center rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                    Architecture Rule D1–D4
                  </span>
                  <h4 className="text-base font-bold text-slate-900 sm:text-lg">
                    1. The Anatomy of a Bundle / Grouped Product
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed sm:text-sm">
                    A Grouped Product is <strong>never sold as abstract pieces</strong>. It is a physical set made of one
                    <strong> Main Component</strong> (created exclusively for the set) plus linked <strong>By-Products</strong>
                    (counted items like hooks, or measured items like load chains).
                  </p>
                </div>

                <div className="rounded-xl border border-indigo-200 bg-white p-3 shadow-xs text-xs space-y-1.5 sm:w-80">
                  <div className="font-bold text-indigo-900 flex items-center justify-between">
                    <span>Set Inventory Ownership</span>
                    <span className="text-[10px] bg-indigo-50 px-2 py-0.5 rounded text-indigo-700">D8 Rule</span>
                  </div>
                  <p className="text-slate-600">
                    Sets are <strong>created only via Purchase</strong> or <strong>Opening Sets</strong>. Once entered, stock is owned by the whole set.
                  </p>
                </div>
              </div>

              {/* Visual Architecture Tree */}
              <div className="mt-6 rounded-xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-xs">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
                  Visual Structure of an Assembled Set
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  {/* Top Level: Set Header */}
                  <div className="sm:col-span-3 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/60 p-4 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-xs">
                      <GroupedIcon className="h-4 w-4" /> GROUPED PRODUCT SET (e.g. Electric Hoist 2 Ton Set)
                    </div>
                    <p className="mt-1 text-xs text-indigo-900 font-medium">
                      Sold under one combined SKU &bull; Holds unique Set Serial Code (e.g. <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-800">EH-2T-8MM-3M-29-10-26-01</code>)
                    </p>
                  </div>

                  {/* Component 1: Main Component */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-800">ROLE: MAIN</span>
                        <span className="text-[11px] font-bold text-emerald-600">Qty 1</span>
                      </div>
                      <h5 className="mt-2 text-sm font-bold text-slate-900">Hoist Body</h5>
                      <p className="text-xs text-slate-500 mt-1">
                        Always a Simple product. Exists <em>only inside sets</em> (cannot be sold or edited loose).
                      </p>
                    </div>
                    <div className="mt-3 text-[11px] font-semibold text-slate-700 pt-2 border-t border-slate-200">
                      Free Stock: 0 (Always inside set)
                    </div>
                  </div>

                  {/* Component 2: Measured By-Product (Chain) */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">ROLE: BY-PRODUCT</span>
                        <span className="text-[11px] font-bold text-amber-800">Measured (3m, 6m...)</span>
                      </div>
                      <h5 className="mt-2 text-sm font-bold text-slate-900">Grade 80 Load Chain</h5>
                      <p className="text-xs text-slate-600 mt-1">
                        Cut to continuous length upon set purchase. Can be shortened or swapped upon sale.
                      </p>
                    </div>
                    <div className="mt-3 text-[11px] font-semibold text-amber-900 pt-2 border-t border-amber-200">
                      Status: Allocated in Set Piece
                    </div>
                  </div>

                  {/* Component 3: Counted By-Product (Hook) */}
                  <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-sky-200 px-2 py-0.5 text-[10px] font-bold text-sky-900">ROLE: BY-PRODUCT</span>
                        <span className="text-[11px] font-bold text-sky-800">Counted (1 Nos)</span>
                      </div>
                      <h5 className="mt-2 text-sm font-bold text-slate-900">Swivel Safety Hook</h5>
                      <p className="text-xs text-slate-600 mt-1">
                        Normal Simple or Variable item. Can be swapped for a heavy-duty or latch hook on demand.
                      </p>
                    </div>
                    <div className="mt-3 text-[11px] font-semibold text-sky-900 pt-2 border-t border-sky-200">
                      Status: Deducted from Free Stock
                    </div>
                  </div>
                </div>
              </div>

              {/* Free Stock Formula Visual Box */}
              <div className="mt-6 rounded-xl bg-slate-900 p-5 text-white">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                      Fundamental Mathematical Invariant
                    </span>
                    <h5 className="text-base font-bold text-white">
                      The Free Stock Equation
                    </h5>
                  </div>
                  <div className="rounded-lg bg-white/10 px-3 py-1 font-mono text-xs text-emerald-300 font-bold">
                    Trigger Protection Enabled
                  </div>
                </div>

                <div className="mt-3 rounded-lg bg-black/40 p-4 font-mono text-sm text-amber-200 sm:text-base text-center overflow-x-auto">
                  Free Stock (Variation, Warehouse) = On-Hand Balance &minus; &sum; (Allocated Set Parts)
                </div>

                <div className="mt-4 grid gap-3 text-xs text-slate-300 sm:grid-cols-3">
                  <div className="rounded bg-white/5 p-3">
                    <strong className="text-white block mb-1">1. Loose Sales Safety:</strong>
                    A customer buying chain over the counter can only draw from <em>Free Stock</em>. It is mathematically impossible to sell chain that is already fitted inside a hoist.
                  </div>
                  <div className="rounded bg-white/5 p-3">
                    <strong className="text-white block mb-1">2. Warehouse Segregation:</strong>
                    Parts in Godown A are allocated against sets in Godown A. Multi-warehouse companies maintain independent allocations.
                  </div>
                  <div className="rounded bg-white/5 p-3">
                    <strong className="text-white block mb-1">3. Zero Double-Counting:</strong>
                    Inventory valuation counts stock on hand once. Component costs are consolidated at the set rate (Rule D11).
                  </div>
                </div>
              </div>
            </div>

            {/* In-Place Cut vs Replacement Visual Comparison (The Most Critical Rule!) */}
            <div className="card p-5 sm:p-6 space-y-5">
              <div>
                <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">
                  Critical Workshop Logic (2026-10-29 Refinement)
                </span>
                <h4 className="text-lg font-bold text-slate-900 mt-1">
                  2. Chain Customization: In-Place Shortening vs. Continuous Lengthening
                </h4>
                <p className="text-xs text-slate-500 sm:text-sm">
                  What happens when a customer says: <em>&ldquo;I want this 5-meter hoist, but with a 3-meter chain&rdquo;</em> versus <em>&ldquo;I need it with an 8-meter chain&rdquo;</em>?
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Scenario A: Shortening */}
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/30 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
                      SCENARIO A: SHORTENING (L_new &lt; L_old)
                    </span>
                    <span className="text-xs font-bold text-emerald-700">100% Guaranteed</span>
                  </div>

                  <h5 className="font-bold text-slate-900 text-sm sm:text-base">
                    In-Place Cut &bull; Never Blocked by Stock Shortage
                  </h5>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    When shortening a chain (e.g. from 5m down to 3m):
                  </p>

                  {/* Step Diagram */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2 rounded-lg bg-white p-2.5 border border-emerald-200 shadow-xs">
                      <span className="font-bold text-emerald-600">Step 1:</span>
                      <span>Existing 5m chain stays in the hoist body</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-white p-2.5 border border-emerald-200 shadow-xs">
                      <span className="font-bold text-emerald-600">Step 2:</span>
                      <span>Workshop technician cuts 2m off with bolt cutters</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-white p-2.5 border border-emerald-200 shadow-xs">
                      <span className="font-bold text-emerald-600">Step 3:</span>
                      <span>
                        The <strong>2m leftover piece instantly returns to Free Stock</strong> as a Cut Piece!
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-emerald-100/80 p-3 text-xs text-emerald-900 font-medium">
                    ✓ <strong>Inventory Impact:</strong> Free stock of chain actually <em>increases</em> by 2m. This operation cannot fail due to shortage.
                  </div>
                </div>

                {/* Scenario B: Lengthening */}
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50/30 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-amber-600 px-3 py-1 text-xs font-bold text-white">
                      SCENARIO B: LENGTHENING (L_new &gt; L_old)
                    </span>
                    <span className="text-xs font-bold text-amber-800">Requires Stock Reel</span>
                  </div>

                  <h5 className="font-bold text-slate-900 text-sm sm:text-base">
                    Continuous Cut Rule &bull; Cannot Splice or Weld
                  </h5>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    When lengthening a chain (e.g. from 3m up to 8m):
                  </p>

                  {/* Step Diagram */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2 rounded-lg bg-white p-2.5 border border-amber-200 shadow-xs">
                      <span className="font-bold text-amber-600">Step 1:</span>
                      <span>Load chain cannot be welded (safety violation)</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-white p-2.5 border border-amber-200 shadow-xs">
                      <span className="font-bold text-amber-600">Step 2:</span>
                      <span>
                        Old 3m chain is <strong>completely uninstalled</strong> and released to Free Stock
                      </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-white p-2.5 border border-amber-200 shadow-xs">
                      <span className="font-bold text-amber-600">Step 3:</span>
                      <span>A brand new continuous 8m piece is cut from reel stock or backordered</span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-amber-100/80 p-3 text-xs text-amber-900 font-medium">
                    ⚠️ <strong>Inventory Impact:</strong> Requires an unbroken piece of &ge; 8m in Free Stock. If unavailable, books a Whole-Combination Backorder.
                  </div>
                </div>
              </div>
            </div>

            {/* Dynamic Repricing & Whole-Combination Backorder */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Dynamic Repricing */}
              <div className="card p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <RupeeIcon className="h-5 w-5 text-emerald-600" />
                  <h4 className="text-base font-bold text-slate-900">
                    3. Dynamic Set Repricing Formula (D12)
                  </h4>
                </div>
                <p className="text-xs text-slate-600">
                  When a customer customizes components during checkout, the line price automatically adjusts in real-time:
                </p>
                <div className="rounded-lg bg-slate-100 p-3 text-xs font-mono text-slate-800 text-center font-bold">
                  New Price = Base Set Price &minus; Old Part Price + New Part Price
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                  <div className="flex justify-between text-slate-600">
                    <span>Base Hoist (with 3m chain @ ₹100/m):</span>
                    <span className="font-semibold text-slate-900">₹15,000</span>
                  </div>
                  <div className="flex justify-between text-rose-600">
                    <span>Remove 3m chain (−3 × ₹100):</span>
                    <span>−₹300</span>
                  </div>
                  <div className="flex justify-between text-emerald-600">
                    <span>Install 6m chain (+6 × ₹100):</span>
                    <span>+₹600</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-slate-200 font-bold text-brand-700">
                    <span>Final Adjusted Sale Price:</span>
                    <span>₹15,300</span>
                  </div>
                </div>
              </div>

              {/* Whole-Combination Backorders */}
              <div className="card p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <PackageIcon className="h-5 w-5 text-indigo-600" />
                  <h4 className="text-base font-bold text-slate-900">
                    4. Whole-Combination Backorders
                  </h4>
                </div>
                <p className="text-xs text-slate-600">
                  What if zero sets exist in stock, but a customer wants to place a confirmed booking order?
                </p>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs space-y-2 text-indigo-950">
                  <p>
                    • Staff can choose <strong>Whole-Combination Backorder</strong> on Sales Orders.
                  </p>
                  <p>
                    • The order stores the exact customer combination (e.g. <em>Hoist + 12m Chain + Latch Hook</em>).
                  </p>
                  <p>
                    • Shortage reports automatically break down which parts must be ordered from suppliers to assemble the finished set.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

      {/* ========================================================================= */}
      {/* SECTION 2: MEASURED INVENTORY & REEL LIFECYCLE                            */}
      {/* ========================================================================= */}
      {(activeTab === "all" || activeTab === "measured") &&
        matchesSearch("measured roll cut piece reel scrap continuous rate ft in") && (
          <section className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 font-bold text-sm">
                    ✂️
                  </span>
                  <h3 className="text-lg font-bold text-slate-900">
                    Measured Inventory, Reels &amp; Scrap Logic
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Continuous cut constraints, scrap write-offs, and multi-unit conversions (Meters, Feet &amp; Inches).
                </p>
              </div>
              <Link href="/settings" className="text-xs font-semibold text-brand-600 hover:underline">
                Configure Scrap Below &rarr;
              </Link>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {/* Card 1: 3-Tier Reel Lifecycle */}
              <div className="card p-5 space-y-3">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                  PHYSICAL LIFECYCLE
                </span>
                <h4 className="text-sm font-bold text-slate-900">
                  1. The 3 Physical Reel States
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
                    <strong className="text-emerald-900 block font-bold">1. Sealed Roll / Drum:</strong>
                    Brand new, unopened factory roll with supplier roll number. Untouched.
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                    <strong className="text-amber-900 block font-bold">2. Open Roll:</strong>
                    Currently mounted on the cutting stand. Cuts are drawn from here first.
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-2.5">
                    <strong className="text-sky-900 block font-bold">3. Cut Pieces (Offcuts):</strong>
                    Leftovers from custom cuts. Prioritized to prevent accumulating short pieces.
                  </div>
                </div>
              </div>

              {/* Card 2: Scrap-Below Logic */}
              <div className="card p-5 space-y-3">
                <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                  AUTOMATED PROMPT
                </span>
                <h4 className="text-sm font-bold text-slate-900">
                  2. Scrap-Below Threshold Rule
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  When a cut leaves an offcut shorter than the company&rsquo;s <strong>Scrap Below length</strong> (e.g. &lt; 1.50m):
                </p>
                <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-xs space-y-1.5 text-rose-950">
                  <p className="font-bold">The system triggers a decision:</p>
                  <p>• <strong>Option A (Write off):</strong> Recorded as scrap loss; stock removed from ledger automatically.</p>
                  <p>• <strong>Option B (Keep):</strong> Stored as a Cut Piece for small customer orders.</p>
                </div>
              </div>

              {/* Card 3: Feet + Inches Conversion */}
              <div className="card p-5 space-y-3">
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                  UNIT CONVERSION
                </span>
                <h4 className="text-sm font-bold text-slate-900">
                  3. Feet &amp; Inches Math
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Avoids floating point drift and price rounding errors:
                </p>
                <div className="space-y-2 text-xs">
                  <div className="rounded bg-slate-50 p-2 border border-slate-200">
                    <span className="text-slate-500 block">Database Storage:</span>
                    <strong className="text-slate-900">Exact inches (whole numbers or thousandths)</strong>
                  </div>
                  <div className="rounded bg-slate-50 p-2 border border-slate-200">
                    <span className="text-slate-500 block">Commercial Pricing:</span>
                    <strong className="text-slate-900">Priced per Foot (Rate Per = 12)</strong>
                  </div>
                  <div className="rounded bg-slate-50 p-2 border border-slate-200">
                    <span className="text-slate-500 block">Valuation:</span>
                    <code className="text-xs font-mono text-brand-700">Value = (Inches / 12) &times; Cost</code>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

      {/* ========================================================================= */}
      {/* SECTION 3: HIGH-MOVING 30-DAY SALES VELOCITY                              */}
      {/* ========================================================================= */}
      {(activeTab === "all" || activeTab === "velocity") &&
        matchesSearch("velocity high moving sort 30 days default order rank sales frequency") && (
          <section className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 font-bold text-sm">
                    ⚡
                  </span>
                  <h3 className="text-lg font-bold text-slate-900">
                    High-Moving Velocity Engine (30-Day Rolling Window)
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automated sales frequency calculation that powers default ordering across Point of Sale, Stock In, and Products.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 shadow-xs">
                  ⚡ Default Active Sort
                </span>
                <Link href="/inventory" className="btn-secondary text-xs">
                  View in Stock In &rarr;
                </Link>
              </div>
            </div>

            {/* 1. Visual 4-Tier Waterfall Architecture */}
            <div className="card p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    SORTING CASCADE
                  </span>
                  <h4 className="text-base font-bold text-slate-900 mt-1">
                    1. Deterministic 4-Tier Ranking Waterfall
                  </h4>
                  <p className="text-xs text-slate-500">
                    Every product is evaluated in SQL at query time. Ties at any level cascade instantaneously to the next tier.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50/60 p-4 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                        TIER 1 (PRIMARY)
                      </span>
                      <span className="h-5 w-5 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">1</span>
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-900">30-Day Invoice Frequency</div>
                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                      Count of <strong>distinct completed invoices</strong> containing this product within the rolling 30-day window:
                      <code className="block mt-1 bg-white p-1 rounded border border-emerald-200 text-emerald-900 font-mono text-[11px]">
                        sale_count_30d DESC
                      </code>
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-emerald-200 text-[11px] font-semibold text-emerald-900">
                    Deduplicates cart lines
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        TIER 2 (RECENCY)
                      </span>
                      <span className="h-5 w-5 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center">2</span>
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-900">Last Sale Recency</div>
                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                      When two products tie on 30-day invoice count, the one sold more recently takes precedence:
                      <code className="block mt-1 bg-slate-50 p-1 rounded border border-slate-200 text-slate-800 font-mono text-[11px]">
                        last_sale_at DESC NULLS LAST
                      </code>
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] font-semibold text-slate-600">
                    Fresh sales rank higher
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        TIER 3 (NEW ITEMS)
                      </span>
                      <span className="h-5 w-5 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center">3</span>
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-900">14-Day Grace Window</div>
                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                      Newly added inventory items have had no time to accrue 30-day history. They are shielded above stagnant zero-sales items:
                      <code className="block mt-1 bg-slate-50 p-1 rounded border border-slate-200 text-slate-800 font-mono text-[11px]">
                        created_at DESC (if &le; 14d)
                      </code>
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] font-semibold text-slate-600">
                    Discovered easily by staff
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        TIER 4 (TIE-BREAKER)
                      </span>
                      <span className="h-5 w-5 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center">4</span>
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-900">Alphabetical (A&ndash;Z)</div>
                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                      For never-sold or identically ranked items, deterministic alphabetical ordering prevents paging flicker:
                      <code className="block mt-1 bg-slate-50 p-1 rounded border border-slate-200 text-slate-800 font-mono text-[11px]">
                        name ASC, id ASC
                      </code>
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] font-semibold text-slate-600">
                    100% Stable Paging
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Mathematical Formula & SQL Engine Callout */}
            <div className="rounded-xl bg-slate-900 p-5 sm:p-6 text-white space-y-4 shadow-md">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Mathematical Formulation &amp; Database Architecture
                  </span>
                  <h4 className="text-base font-bold text-white mt-0.5">
                    Rolling 30-Day Distinct Frequency Invariant
                  </h4>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded bg-emerald-500/20 px-2.5 py-1 text-xs font-mono text-emerald-300 border border-emerald-500/30">
                  SQL CTE: s30 &bull; Real-Time Aggregation
                </div>
              </div>

              {/* Equation Box */}
              <div className="rounded-lg bg-black/50 p-4 text-center font-mono text-xs sm:text-sm text-emerald-200 overflow-x-auto border border-white/10">
                Velocity_30d(P) = COUNT(DISTINCT s.id) WHERE s.status = &apos;COMPLETED&apos; AND s.sale_date &ge; (CURRENT_TIMESTAMP &minus; INTERVAL &apos;30 days&apos;) AND s.id NOT IN (document_voids)
              </div>

              {/* Technical CTE Snippet */}
              <div className="grid gap-4 sm:grid-cols-2 text-xs text-slate-300">
                <div className="rounded-lg bg-white/5 p-4 space-y-2 border border-white/5">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <span className="text-emerald-400">&bull;</span> Why Invoices, Not Quantity?
                  </div>
                  <p className="leading-relaxed text-slate-300">
                    If customer A buys <strong>1,000 bolts</strong> once, that is 1 transaction. If 20 different customers buy <strong>1 hoist</strong> each, that is 20 transactions. Counting distinct invoices measures true customer demand velocity rather than skewed bulk lot sizes.
                  </p>
                </div>
                <div className="rounded-lg bg-white/5 p-4 space-y-2 border border-white/5">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <span className="text-emerald-400">&bull;</span> Group-Level Consolidation
                  </div>
                  <p className="leading-relaxed text-slate-300">
                    For variable and measured products, sales across all individual variations (e.g. 8mm 3m, 8mm 6m, 10mm 3m) are aggregated up to the parent product group. This ensures the entire product family reflects collective market movement.
                  </p>
                </div>
              </div>
            </div>

            {/* 3. Trade Rationale Comparison: Why 30 Days? */}
            <div className="card p-5 sm:p-6 space-y-4">
              <div>
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                  BUSINESS DESIGN CHOICE
                </span>
                <h4 className="text-base font-bold text-slate-900 mt-1">
                  2. Why a Rolling 30-Day Window? (Model Comparison)
                </h4>
                <p className="text-xs text-slate-500">
                  How the 30-day rolling model outperforms traditional lifetime counting and short flash windows in machinery trade:
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-rose-900">MODEL A: LIFETIME SALES</span>
                    <span className="text-xs text-rose-600 font-bold">&#10005; Obsolete</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Accumulates all sales since system inception. A product that was popular 2 years ago but is now obsolete stays permanently pinned to page 1, blinding staff to what is actually selling this month.
                  </p>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-amber-900">MODEL B: 7-DAY WINDOW</span>
                    <span className="text-xs text-amber-600 font-bold">&#9888; Hyper-Volatile</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Too short for B2B machinery. A single industrial contract order on Tuesday alters the entire shop layout until Friday, causing layout whiplash and erratic browsing for counter clerks.
                  </p>
                </div>

                <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 p-4 space-y-2 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-emerald-900">MODEL C: ROLLING 30-DAY</span>
                    <span className="text-xs text-emerald-700 font-bold">&#10003; Trade Standard</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    Matches the standard 30-day payment and stocking cycle. Daily sliding decay automatically retires cooling items without requiring manual catalog administration or batch scripts.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Realistic Worked Ranking Simulator */}
            <div className="card p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                    LIVE SIMULATION
                  </span>
                  <h4 className="text-base font-bold text-slate-900 mt-1">
                    3. Worked Ranking Simulation (Real Trade Example)
                  </h4>
                  <p className="text-xs text-slate-500">
                    Demonstrating how the 4-tier sorting waterfall resolves rankings across different products:
                  </p>
                </div>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
                  Simulated Time: Now
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-14">Rank</th>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3 text-center">Invoices (30D)</th>
                      <th className="py-2.5 px-3">Last Sale</th>
                      <th className="py-2.5 px-3">Waterfall Resolution Reason</th>
                      <th className="py-2.5 px-3 text-right">Badge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    <tr className="bg-emerald-50/40">
                      <td className="py-2.5 px-3 font-bold text-emerald-700">#1</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">Grade 80 Alloy Load Chain 8mm</td>
                      <td className="py-2.5 px-3 text-slate-500">Chains &amp; Fittings</td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-700">24</td>
                      <td className="py-2.5 px-3 text-slate-600">Today, 2:15 PM</td>
                      <td className="py-2.5 px-3 text-slate-600">Tier 1: Highest 30-day invoice frequency</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                          ⚡ High Moving (24)
                        </span>
                      </td>
                    </tr>
                    <tr className="bg-emerald-50/20">
                      <td className="py-2.5 px-3 font-bold text-emerald-700">#2</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">Electric Chain Hoist 2 Ton Set</td>
                      <td className="py-2.5 px-3 text-slate-500">Lifting Equipment</td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-700">19</td>
                      <td className="py-2.5 px-3 text-slate-600">Yesterday</td>
                      <td className="py-2.5 px-3 text-slate-600">Tier 2: Recency tiebreaker wins over Swivel Hook</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                          ⚡ High Moving (19)
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-bold text-slate-700">#3</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">Swivel Safety Hook 1 Ton</td>
                      <td className="py-2.5 px-3 text-slate-500">Rigging Hardware</td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-700">19</td>
                      <td className="py-2.5 px-3 text-slate-600">4 days ago</td>
                      <td className="py-2.5 px-3 text-slate-600">Tier 2: Same 19 invoices, but older sale date than Hoist</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                          ⚡ High Moving (19)
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-bold text-slate-700">#4</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">Wire Rope 6x19 16mm (Galvanised)</td>
                      <td className="py-2.5 px-3 text-slate-500">Wire Rope</td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-700">6</td>
                      <td className="py-2.5 px-3 text-slate-600">12 days ago</td>
                      <td className="py-2.5 px-3 text-slate-600">Tier 1: Regular steady seller</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                          ⚡ High Moving (6)
                        </span>
                      </td>
                    </tr>
                    <tr className="bg-sky-50/30">
                      <td className="py-2.5 px-3 font-bold text-sky-700">#5</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">Stainless Rigging Turnbuckle M16</td>
                      <td className="py-2.5 px-3 text-slate-500">Rigging Hardware</td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-400">0</td>
                      <td className="py-2.5 px-3 text-slate-400">—</td>
                      <td className="py-2.5 px-3 text-sky-800">Tier 3: Created 3 days ago (14-day new item grace)</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                          New Item
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-bold text-slate-400">#6</td>
                      <td className="py-2.5 px-3 font-bold text-slate-700">Bow Shackle 12mm Galvanised</td>
                      <td className="py-2.5 px-3 text-slate-500">Rigging Hardware</td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-400">0</td>
                      <td className="py-2.5 px-3 text-slate-400">—</td>
                      <td className="py-2.5 px-3 text-slate-500">Tier 4: Alphabetical tie-breaker (&ldquo;B&rdquo; before &ldquo;D&rdquo;)</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-[10px] text-slate-400">—</span>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-bold text-slate-400">#7</td>
                      <td className="py-2.5 px-3 text-slate-700">Dee Shackle 12mm Galvanised</td>
                      <td className="py-2.5 px-3 text-slate-500">Rigging Hardware</td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-400">0</td>
                      <td className="py-2.5 px-3 text-slate-400">—</td>
                      <td className="py-2.5 px-3 text-slate-500">Tier 4: Alphabetical tie-breaker (&ldquo;D&rdquo; after &ldquo;B&rdquo;)</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-[10px] text-slate-400">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 5. In-App Touchpoints */}
            <div className="card p-5 sm:p-6 space-y-4">
              <div>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  INTEGRATED ACROSS APP
                </span>
                <h4 className="text-base font-bold text-slate-900 mt-1">
                  4. Where High-Moving Order is Active
                </h4>
                <p className="text-xs text-slate-500">
                  The 30-day velocity order is the universal default across all key operational screens:
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
                    <PackageIcon className="h-4 w-4 text-emerald-600" /> Point of Sale &amp; Purchases
                  </div>
                  <p className="text-xs text-slate-600">
                    In the product selection dialog (<code className="text-xs">ProductBrowser</code>), cards are ordered by High Moving so clerks add top sellers without typing search queries.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
                    <BoxesIcon className="h-4 w-4 text-emerald-600" /> Stock In (/inventory)
                  </div>
                  <p className="text-xs text-slate-600">
                    Fast-depleting items appear at the very top of the receiving sheet, saving warehouse managers time during stock receipts and count entries.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
                    <LayersIcon className="h-4 w-4 text-emerald-600" /> Products Catalog (/products)
                  </div>
                  <p className="text-xs text-slate-600">
                    General catalog overview sorts top active products first, reflecting current commercial momentum at a glance.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

      {/* ========================================================================= */}
      {/* SECTION 4: PRICING GUARDS & COMMERCIAL CONTROLS                           */}
      {/* ========================================================================= */}
      {(activeTab === "all" || activeTab === "pricing") &&
        matchesSearch("pricing guard min sale price cost margin vendor quote") && (
          <section className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 font-bold text-sm">
                    🛡️
                  </span>
                  <h3 className="text-lg font-bold text-slate-900">
                    Commercial Guards &amp; Margin Protection
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Strict constraints preventing accidental pricing mistakes, below-minimum selling, and loss leader errors.
                </p>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Rule 1: Min SP <= SP */}
              <div className="card p-5 space-y-3 border-l-4 border-l-rose-500">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-sm sm:text-base">
                    Minimum Selling Price Guard (BR-08a)
                  </h4>
                  <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                    Hard Constraint
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  The system actively prohibits Minimum Selling Price from exceeding Selling Price:
                </p>
                <div className="rounded-lg bg-rose-50 p-3 text-xs font-mono text-rose-900 text-center font-bold border border-rose-200">
                  Minimum Selling Price &le; Selling Price
                </div>
                <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                  <li><strong>Real-time UI alert:</strong> Input borders turn red with warning badge <em>&ldquo;Must be &le; SP&rdquo;</em>.</li>
                  <li><strong>API validation:</strong> Rejects with HTTP 400 <code className="text-rose-700 font-bold">INVALID_PRICE</code>.</li>
                  <li>Applies across Simple, Variable, Measured, and Grouped Set types.</li>
                </ul>
              </div>

              {/* Rule 2: Negative Stock Warn & Allow */}
              <div className="card p-5 space-y-3 border-l-4 border-l-amber-500">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-sm sm:text-base">
                    Negative Stock &ldquo;Warn &amp; Allow&rdquo; Policy
                  </h4>
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    Fixed Policy
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Counter sales may proceed even if recorded stock is zero or negative:
                </p>
                <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside">
                  <li>Staff receive an unmistakable shortage alert and must confirm.</li>
                  <li>Every below-zero sale is recorded permanently in the Audit Log with user identity.</li>
                  <li>Incoming supplier purchases automatically reconcile negative counts back to positive.</li>
                </ul>
              </div>
            </div>
          </section>
        )}

      {/* ========================================================================= */}
      {/* SECTION 5: SCREENSHOT & VISUAL DEMONSTRATION CONTAINER                      */}
      {/* ========================================================================= */}
      <section className="card p-6 space-y-4 border-slate-200 bg-slate-50/50">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>📸</span> Real-World Screenshots &amp; Visual Evidence
            </h4>
            <p className="text-xs text-slate-500">
              Drop screenshot PNG/JPEG files into the application to display visual references directly on this page.
            </p>
          </div>
          <span className="inline-flex items-center rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
            Storage: <code className="ml-1 text-slate-900 font-mono">public/docs/screenshots/</code>
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Screenshot Slot 1: Bundle Customization */}
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <GroupedIcon className="h-6 w-6" />
            </div>
            <div className="font-bold text-xs text-slate-800">Bundle Customization Modal Screenshot</div>
            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
              Drop <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700 font-mono">bundle-modal.png</code> into public folder to display the live component swap and in-place cut UI.
            </p>
          </div>

          {/* Screenshot Slot 2: Reel Cutting */}
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center space-y-2">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <BoxesIcon className="h-6 w-6" />
            </div>
            <div className="font-bold text-xs text-slate-800">Reel Cutting Stand &amp; Scrap Prompt Screenshot</div>
            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
              Drop <code className="bg-slate-100 px-1 py-0.5 rounded text-amber-700 font-mono">cut-prompt.png</code> to showcase the residual scrap threshold prompt in action.
            </p>
          </div>

          {/* Screenshot Slot 3: High Moving Catalog */}
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center space-y-2 sm:col-span-2 lg:col-span-1">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <SlidersIcon className="h-6 w-6" />
            </div>
            <div className="font-bold text-xs text-slate-800">High-Moving Stock &amp; Velocity Badge Screenshot</div>
            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
              Drop <code className="bg-slate-100 px-1 py-0.5 rounded text-emerald-700 font-mono">high-moving-catalog.png</code> to showcase the <span className="text-emerald-700 font-semibold">⚡ High Moving</span> product card badges and default sorting in action.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
