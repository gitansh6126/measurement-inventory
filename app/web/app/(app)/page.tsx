"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  BoxesIcon,
  BuildingIcon,
  CartIcon,
  ChevronIcon,
  CogIcon,
  DatabaseIcon,
  InvoiceIcon,
  OrderIcon,
  PackageIcon,
  PlusIcon,
  QuoteIcon,
  ShiftIcon,
  TagIcon,
  TruckIcon,
  UsersIcon,
  WarehouseIcon,
  WarnIcon,
} from "@/components/icons";
import { useCart } from "@/components/CartContext";
import { useCan, useMe } from "@/components/MeContext";
import { useWarehouses } from "@/lib/useWarehouses";
import { useApi } from "@/lib/useApi";
import { qty } from "@/lib/format";
import type { StockProduct } from "@/lib/types";

interface OrderRow {
  id: string;
  number: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  partyName: string | null;
  total: string;
  lineCount: number;
}

interface OrdersResponse {
  orders: OrderRow[];
  counts: Record<string, number>;
  total: number;
}

export default function HomePage() {
  const me = useMe();
  const cart = useCart();
  const wh = useWarehouses();

  const canCreateSale = useCan("sale.create");
  const canCreatePurchase = useCan("purchase.create");
  const canViewCatalog = useCan("catalog.view");
  const canViewSales = useCan("sale.view");
  const canViewPurchases = useCan("purchase.view");
  const canViewVendorPrices = useCan("vendor_pricing.view");
  const canManageWarehouse = useCan("warehouse.manage");
  const canManageUsers = useCan("user.manage");
  const canConfigureSettings = useCan("company.settings");

  // Live operational data queries
  const { data: inventoryData, loading: loadingInventory } = useApi<{ products: StockProduct[] }>(
    canViewCatalog ? "/inventory?status=all" : null
  );
  const { data: saleOrdersData, loading: loadingSaleOrders } = useApi<OrdersResponse>(
    canViewSales ? "/orders?kind=SALE&status=OPEN" : null
  );
  const { data: purchaseOrdersData, loading: loadingPurchaseOrders } = useApi<OrdersResponse>(
    canViewPurchases ? "/orders?kind=PURCHASE&status=OPEN" : null
  );

  // Stock calculations
  const products = inventoryData?.products ?? [];
  const lowStockProducts = useMemo(() => {
    return products.filter((p) => p.quantity <= p.lowStockThreshold);
  }, [products]);
  const outOfStockProducts = useMemo(() => {
    return products.filter((p) => p.quantity === 0);
  }, [products]);

  // Sale Orders status breakdown
  const saleCounts = saleOrdersData?.counts ?? {};
  const saleOpen = saleCounts.OPEN ?? 0;
  const saleDrafts = saleCounts.DRAFT ?? 0;
  const salePlaced = saleCounts.PLACED ?? 0;
  const saleBackorders = saleCounts.PARTIALLY_FULFILLED ?? 0;
  const recentSaleOrders = saleOrdersData?.orders?.slice(0, 3) ?? [];

  // Purchase Orders status breakdown
  const purchaseCounts = purchaseOrdersData?.counts ?? {};
  const purchaseOpen = purchaseCounts.OPEN ?? 0;
  const purchaseDrafts = purchaseCounts.DRAFT ?? 0;
  const purchasePlaced = purchaseCounts.PLACED ?? 0;
  const recentPurchaseOrders = purchaseOrdersData?.orders?.slice(0, 3) ?? [];

  // Cart status
  const cartLinesCount = cart.count;
  const cartShortLines = cart.mode === "sale" ? cart.lines.filter((l) => l.quantity > l.available).length : 0;

  const todayStr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date());
    } catch {
      return "Today";
    }
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-12">
      {/* 1. TOP HEADER & 2 PRIMARY ACTION BUTTONS (NEW SALE & NEW PURCHASE) */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 -mb-16 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-brand-200 backdrop-blur-md border border-white/10">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                RS Machinery Inventory
              </span>
              <span className="rounded-full bg-brand-500/20 px-2.5 py-0.5 text-xs font-medium text-brand-300 border border-brand-500/30 uppercase tracking-wider">
                {me?.user?.role?.replace("_", " ") ?? "Staff"}
              </span>
              <span className="text-xs text-slate-400 font-medium">{todayStr}</span>
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">
              Welcome back, <span className="text-brand-400">{me?.user?.name || "Operator"}</span>
            </h1>
          </div>

          {/* 2 PROMINENT TOP BUTTONS: NEW SALE & NEW PURCHASE */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            {canCreateSale && (
              <Link
                href="/sales/new"
                className="group inline-flex items-center justify-center gap-2.5 rounded-2xl bg-emerald-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-950/40 transition-all hover:bg-emerald-500 hover:scale-[1.02] active:scale-100"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-white transition-transform group-hover:scale-110">
                  <CartIcon className="h-4 w-4" />
                </span>
                <span>+ New Sale</span>
              </Link>
            )}

            {canCreatePurchase && (
              <Link
                href="/purchases/new"
                className="group inline-flex items-center justify-center gap-2.5 rounded-2xl bg-brand-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand-950/40 transition-all hover:bg-brand-500 hover:scale-[1.02] active:scale-100"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-white transition-transform group-hover:scale-110">
                  <TruckIcon className="h-4 w-4" />
                </span>
                <span>+ New Purchase</span>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ACTIVE CART ALERT BANNER (If user has items in cart) */}
      {cartLinesCount > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50/70 p-4 text-sm shadow-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <CartIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold text-slate-900">
                You have <span className="text-brand-700 font-bold">{cartLinesCount} item{cartLinesCount === 1 ? "" : "s"}</span> in your active {cart.mode} cart
                {cartShortLines > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">
                    ⚠️ {cartShortLines} line{cartShortLines === 1 ? "" : "s"} exceed available stock
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">Resume your customer counter checkout or purchase order right where you left off.</p>
            </div>
          </div>
          <Link
            href={cart.mode === "sale" ? "/sales/checkout" : "/purchases/checkout"}
            className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-700 shrink-0"
          >
            <span>Go to Checkout</span>
            <ChevronIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* 2. OPERATIONAL PULSE & LIVE ALERTS (LOW STOCK, SALE ORDERS, PURCHASE ORDERS) */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* A. LOW STOCK & DEPLETION ALERT CARD */}
          <div className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border p-5 shadow-xs transition-all ${
            lowStockProducts.length > 0
              ? "border-amber-200/90 bg-gradient-to-br from-amber-50/70 via-white to-amber-50/30"
              : "border-slate-200 bg-white"
          }`}>
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-xs ${
                    lowStockProducts.length > 0 ? "bg-amber-500 text-white" : "bg-emerald-100 text-emerald-700"
                  }`}>
                    <WarnIcon className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Low Stock Attention</h3>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold border ${
                  lowStockProducts.length > 0
                    ? "bg-amber-100 text-amber-900 border-amber-300"
                    : "bg-emerald-100 text-emerald-800 border-emerald-200"
                }`}>
                  {loadingInventory ? "..." : `${lowStockProducts.length} items`}
                </span>
              </div>

              {/* Status Breakdown Pills */}
              <div className="mt-3.5 flex items-center gap-2 text-xs">
                <Link
                  href="/products?quick=low"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100/80 px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-200 transition"
                  title="View low stock items"
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>{lowStockProducts.length} Low</span>
                </Link>
                <Link
                  href="/products?quick=out"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-100/80 px-2.5 py-1 font-semibold text-rose-900 hover:bg-rose-200 transition"
                  title="View out of stock items"
                >
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span>{outOfStockProducts.length} Depleted (0)</span>
                </Link>
              </div>

              {/* Item Previews */}
              <div className="mt-3 space-y-1.5">
                {loadingInventory ? (
                  <div className="space-y-1.5 py-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                  </div>
                ) : lowStockProducts.length > 0 ? (
                  lowStockProducts.slice(0, 3).map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-xs rounded-lg bg-white/90 border border-amber-200/60 px-2.5 py-1.5 shadow-2xs">
                      <span className="font-semibold text-slate-800 truncate max-w-[170px]" title={item.name}>
                        {item.name}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-bold ${item.quantity === 0 ? "text-rose-600" : "text-amber-700"}`}>
                          {item.quantity === 0 ? "0 in stock" : `${qty(item.quantity)} ${item.unit || "units"}`}
                        </span>
                        <span className="text-[10px] text-slate-400">Min: {item.lowStockThreshold}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    All stock levels are above threshold limits
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 pt-2 border-t border-amber-200/50">
              <Link
                href="/products?quick=low"
                className="flex-1 text-center rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-2xs hover:bg-amber-700 transition"
              >
                View Low Stock ({lowStockProducts.length})
              </Link>
              <Link
                href="/inventory?stage=low"
                className="rounded-xl bg-white border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                title="Restock on Stock In page"
              >
                Restock
              </Link>
            </div>
          </div>

          {/* B. SALE ORDERS & BACKORDERS PULSE CARD */}
          <div className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border p-5 shadow-xs transition-all ${
            saleBackorders > 0 || saleOpen > 0
              ? "border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 via-white to-indigo-50/30"
              : "border-slate-200 bg-white"
          }`}>
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
                    <OrderIcon className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Sale Orders & Backorders</h3>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold border ${
                  saleBackorders > 0
                    ? "bg-rose-100 text-rose-900 border-rose-300"
                    : "bg-indigo-100 text-indigo-900 border-indigo-300"
                }`}>
                  {loadingSaleOrders ? "..." : saleBackorders > 0 ? `${saleBackorders} Backorder${saleBackorders === 1 ? "" : "s"}` : `${saleOpen} Open`}
                </span>
              </div>

              {/* Status Breakdown Pills */}
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5 text-xs">
                <Link
                  href="/sales/orders?status=OPEN"
                  className="rounded-lg bg-indigo-100/80 px-2 py-1 font-semibold text-indigo-900 hover:bg-indigo-200 transition"
                >
                  {saleOpen} Open
                </Link>
                {saleBackorders > 0 && (
                  <Link
                    href="/sales/orders?status=PARTIALLY_FULFILLED"
                    className="rounded-lg bg-rose-100 px-2 py-1 font-bold text-rose-800 hover:bg-rose-200 transition"
                  >
                    ⚠️ {saleBackorders} Backorders
                  </Link>
                )}
                <Link
                  href="/sales/orders?status=DRAFT"
                  className="rounded-lg bg-slate-100 px-2 py-1 font-medium text-slate-700 hover:bg-slate-200 transition"
                >
                  {saleDrafts} Drafts
                </Link>
                <Link
                  href="/sales/orders?status=PLACED"
                  className="rounded-lg bg-emerald-100/80 px-2 py-1 font-medium text-emerald-800 hover:bg-emerald-200 transition"
                >
                  {salePlaced} Placed
                </Link>
              </div>

              {/* Recent Orders Preview */}
              <div className="mt-3 space-y-1.5">
                {loadingSaleOrders ? (
                  <div className="space-y-1.5 py-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                  </div>
                ) : recentSaleOrders.length > 0 ? (
                  recentSaleOrders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/sales/orders/${order.id}`}
                      className="flex items-center justify-between text-xs rounded-lg bg-white/90 border border-indigo-200/60 px-2.5 py-1.5 shadow-2xs hover:border-brand-400 transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900">{order.number}</span>
                          {order.status === "PARTIALLY_FULFILLED" && (
                            <span className="rounded bg-rose-100 text-[10px] font-bold text-rose-800 px-1 py-0.2">Backorder</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">{order.partyName || "Counter Client"}</p>
                      </div>
                      <span className="font-semibold text-slate-900 shrink-0">₹{order.total}</span>
                    </Link>
                  ))
                ) : (
                  <p className="py-2 text-xs text-slate-500 font-medium">No open customer bookings pending.</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 pt-2 border-t border-indigo-200/50">
              {saleBackorders > 0 ? (
                <Link
                  href="/sales/orders?status=PARTIALLY_FULFILLED"
                  className="flex-1 text-center rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-2xs hover:bg-rose-700 transition"
                >
                  Manage Backorders ({saleBackorders})
                </Link>
              ) : (
                <Link
                  href="/sales/orders?status=OPEN"
                  className="flex-1 text-center rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700 transition"
                >
                  All Open Orders ({saleOpen})
                </Link>
              )}
              <Link
                href="/sales/orders?status=DRAFT"
                className="rounded-xl bg-white border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                title="View draft orders"
              >
                Drafts ({saleDrafts})
              </Link>
            </div>
          </div>

          {/* C. PURCHASE ORDERS & PROCUREMENT PULSE CARD */}
          <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-xs">
                    <QuoteIcon className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Purchase Orders</h3>
                  </div>
                </div>
                <span className="rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 px-2.5 py-0.5 text-xs font-extrabold">
                  {loadingPurchaseOrders ? "..." : `${purchaseOpen} Open`}
                </span>
              </div>

              {/* Status Breakdown Pills */}
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5 text-xs">
                <Link
                  href="/purchases/orders?status=OPEN"
                  className="rounded-lg bg-cyan-100/80 px-2 py-1 font-semibold text-cyan-900 hover:bg-cyan-200 transition"
                >
                  {purchaseOpen} Open POs
                </Link>
                <Link
                  href="/purchases/orders?status=DRAFT"
                  className="rounded-lg bg-slate-100 px-2 py-1 font-medium text-slate-700 hover:bg-slate-200 transition"
                >
                  {purchaseDrafts} Drafts
                </Link>
                <Link
                  href="/purchases/orders?status=PLACED"
                  className="rounded-lg bg-blue-100/80 px-2 py-1 font-medium text-blue-800 hover:bg-blue-200 transition"
                >
                  {purchasePlaced} Placed
                </Link>
              </div>

              {/* Recent POs Preview */}
              <div className="mt-3 space-y-1.5">
                {loadingPurchaseOrders ? (
                  <div className="space-y-1.5 py-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                  </div>
                ) : recentPurchaseOrders.length > 0 ? (
                  recentPurchaseOrders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/purchases/orders/${order.id}`}
                      className="flex items-center justify-between text-xs rounded-lg bg-white/90 border border-slate-200 px-2.5 py-1.5 shadow-2xs hover:border-brand-400 transition"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-bold text-slate-900">{order.number}</span>
                        <p className="text-[11px] text-slate-500 truncate">{order.partyName || "Supplier"}</p>
                      </div>
                      <span className="font-semibold text-slate-900 shrink-0">₹{order.total}</span>
                    </Link>
                  ))
                ) : (
                  <p className="py-2 text-xs text-slate-500 font-medium">No open purchase orders pending delivery.</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 pt-2 border-t border-slate-100">
              <Link
                href="/purchases/orders?status=OPEN"
                className="flex-1 text-center rounded-xl bg-cyan-700 px-3 py-2 text-xs font-bold text-white shadow-2xs hover:bg-cyan-800 transition"
              >
                Track Open POs ({purchaseOpen})
              </Link>
              <Link
                href="/purchases/new"
                className="rounded-xl bg-white border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                + Create PO
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 3. WORKING WORKFLOW HUBS (ORGANIZED BY DAILY WORKING OPERATIONS) */}
      <section className="space-y-6 pt-2">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* WORKFLOW 1: SUPPLIER RATES & VENDOR PRICING (PRODUCT VIEW VS SUPPLIER VIEW) */}
          {canViewVendorPrices && (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
                    <TagIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Supplier Rates & Benchmarking</h3>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* BUTTON A: COMPARE PRICE BETWEEN SUPPLIERS (PRODUCT VIEW) */}
                  <Link
                    href="/supplier-prices?view=product"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-rose-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-rose-700">
                        <span>Product View</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-rose-700 transition-colors">
                        Compare Prices Between Suppliers
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
                      Best Quote Finder &rarr;
                    </span>
                  </Link>

                  {/* BUTTON B: RECORD PRICE FOR SUPPLIER (SUPPLIER VIEW) */}
                  <Link
                    href="/supplier-prices"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-rose-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-purple-700">
                        <span>Supplier View</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-purple-700 transition-colors">
                        Record Price for Supplier
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-purple-700">
                      Rate Card Entry &rarr;
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* WORKFLOW 2: TRANSACTION HISTORY (SALE HISTORY & PURCHASE HISTORY IN ONE ROW) */}
          {(canViewSales || canViewPurchases) && (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 border border-violet-100">
                    <InvoiceIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Invoices & Transaction History</h3>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* BUTTON A: SALE HISTORY */}
                  <Link
                    href="/sales"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-violet-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-violet-700">
                        <span>Tax Invoices</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-violet-700 transition-colors">
                        Sale History
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-violet-700">
                      Open Sale History &rarr;
                    </span>
                  </Link>

                  {/* BUTTON B: PURCHASE HISTORY */}
                  <Link
                    href="/purchases"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-blue-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-blue-700">
                        <span>Vendor Bills</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                        Purchase History
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700">
                      Open Purchase History &rarr;
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* WORKFLOW 3: PARTIES & CONTACTS (CUSTOMERS & SUPPLIERS IN ONE ROW) */}
          {(canViewSales || canViewPurchases) && (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
                    <UsersIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Customer & Supplier Directory</h3>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* BUTTON A: CUSTOMERS */}
                  <Link
                    href="/customers"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-sky-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-sky-700">
                        <span>Clients</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-sky-700 transition-colors">
                        Customers Directory
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-sky-700">
                      Browse Customers &rarr;
                    </span>
                  </Link>

                  {/* BUTTON B: SUPPLIERS */}
                  <Link
                    href="/suppliers"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-cyan-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-cyan-700">
                        <span>Vendors</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-cyan-700 transition-colors">
                        Suppliers Directory
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-cyan-700">
                      Browse Suppliers &rarr;
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* WORKFLOW 4: STOCK & CATALOG OPERATIONS (STOCK IN & PRODUCTS CATALOG IN ONE ROW) */}
          {canViewCatalog && (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <BoxesIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">Stock & Catalog Operations</h3>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* BUTTON A: STOCK IN & ADJUSTMENT */}
                  <Link
                    href="/inventory"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-emerald-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-700">
                        <span>Inventory Levels</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                        Stock In & Adjustment
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                      Open Stock In &rarr;
                    </span>
                  </Link>

                  {/* BUTTON B: PRODUCTS CATALOG */}
                  <Link
                    href="/products"
                    className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-blue-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-blue-700">
                        <span>Master Items</span>
                        <ChevronIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                        Products Catalog
                      </h4>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700">
                      Browse Catalog &rarr;
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 4. SYSTEM & LOGISTICS UTILITIES (CLEAN BOTTOM STRIP) */}
      {(canManageWarehouse || canManageUsers || canConfigureSettings) && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Logistics & Administration Tools
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {canManageWarehouse && (
                <Link
                  href="/warehouses"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                >
                  <WarehouseIcon className="h-3.5 w-3.5 text-slate-500" />
                  <span>Warehouses</span>
                </Link>
              )}

              {wh.enabled && canViewCatalog && (
                <Link
                  href="/shifts"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                >
                  <ShiftIcon className="h-3.5 w-3.5 text-indigo-500" />
                  <span>Stock Shifts</span>
                </Link>
              )}

              {canManageUsers && (
                <Link
                  href="/users"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                >
                  <UsersIcon className="h-3.5 w-3.5 text-blue-500" />
                  <span>Users & Access</span>
                </Link>
              )}

              {canManageUsers && (
                <Link
                  href="/backup"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                >
                  <DatabaseIcon className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Backup & Restore</span>
                </Link>
              )}

              {canConfigureSettings && (
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                >
                  <CogIcon className="h-3.5 w-3.5 text-slate-600" />
                  <span>Settings</span>
                </Link>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
