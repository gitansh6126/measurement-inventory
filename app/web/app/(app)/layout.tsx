"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { CartProvider } from "@/components/CartContext";
import { CartPill } from "@/components/CartPill";
import { DisplayPanel } from "@/components/DisplayPanel";
import { ArrowInIcon, BookIcon, BoxesIcon, BuildingIcon, CartIcon, CloseIcon, CogIcon, DatabaseIcon, InvoiceIcon, LayersIcon, LogOutIcon, OrderIcon, PackageIcon, QuoteIcon, ShiftIcon, SlidersIcon, TagIcon, TruckIcon, UsersIcon, WarehouseIcon } from "@/components/icons";
import { MeContext } from "@/components/MeContext";
import { TableStackLabels } from "@/components/TableStackLabels";
import { QueryClientProvider } from "@tanstack/react-query";
import { ApiError, api, type Me, type VersionInfo } from "@/lib/api";
import { queryClient } from "@/lib/useApi";
import { LengthScopeProvider } from "@/lib/lengthView";

// App shell from marble 2110 (app/(app)/layout.tsx): icon sidebar that widens on hover/focus,
// slim top bar, slide-in menu on small screens. Menu = main v2 navigation limited to V1 (D23).
// `warehousing`: shown only once warehousing is on (WH-0); Warehouses itself is always there for admins.
type NavItem = { href: string; label: string; icon: ReactNode; permission?: string; exact?: boolean; warehousing?: boolean };
const ic = "h-[18px] w-[18px]";
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Inventory",
    items: [
      { href: "/products", label: "Products", icon: <PackageIcon className={ic} />, permission: "catalog.view" },
      { href: "/products/categories", label: "Categories", icon: <LayersIcon className={ic} />, permission: "catalog.view" },
      { href: "/inventory", label: "Stock In", icon: <BoxesIcon className={ic} />, permission: "catalog.view" },
    ],
  },
  {
    section: "Sales",
    items: [
      { href: "/sales/new", label: "New Sale", icon: <CartIcon className={ic} />, permission: "sale.create" },
      { href: "/sales/orders", label: "Sale Orders", icon: <OrderIcon className={ic} />, permission: "sale.view" },
      { href: "/sales", label: "Sale History", icon: <InvoiceIcon className={ic} />, permission: "sale.view", exact: true },
    ],
  },
  {
    section: "Purchase",
    items: [
      { href: "/purchases/new", label: "New Purchase", icon: <TruckIcon className={ic} />, permission: "purchase.create" },
      { href: "/purchases/orders", label: "Purchase Orders", icon: <QuoteIcon className={ic} />, permission: "purchase.view" },
      { href: "/purchases", label: "Purchase History", icon: <BookIcon className={ic} />, permission: "purchase.view", exact: true },
      { href: "/supplier-prices", label: "Supplier Prices", icon: <TagIcon className={ic} />, permission: "vendor_pricing.view" },
    ],
  },
  {
    section: "Customers",
    items: [
      { href: "/customers", label: "Customers", icon: <UsersIcon className={ic} />, permission: "sale.view" },
    ],
  },
  {
    section: "Suppliers",
    items: [
      { href: "/suppliers", label: "Suppliers", icon: <BuildingIcon className={ic} />, permission: "purchase.view" },
    ],
  },
  {
    section: "Stock Tools",
    items: [
      { href: "/import", label: "Import", icon: <ArrowInIcon className={ic} />, permission: "catalog.view" },
      { href: "/shifts", label: "Shifts", icon: <ShiftIcon className={ic} />, permission: "catalog.view", warehousing: true },
      { href: "/warehouses", label: "Warehouses", icon: <WarehouseIcon className={ic} />, permission: "warehouse.manage" },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/users", label: "Users", icon: <UsersIcon className={ic} />, permission: "user.manage" },
      { href: "/backup", label: "Backup & Restore", icon: <DatabaseIcon className={ic} />, permission: "user.manage" },
      { href: "/demo-data", label: "Demo Data", icon: <LayersIcon className={ic} />, permission: "company.settings" },
      { href: "/settings", label: "Settings", icon: <CogIcon className={ic} />, permission: "company.settings" },
    ],
  },
  {
    section: "Help",
    items: [
      { href: "/rules", label: "Business Logic", icon: <SlidersIcon className={ic} /> },
      { href: "/glossary", label: "Glossary", icon: <BookIcon className={ic} /> },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const closeDisplay = useCallback(() => setDisplayOpen(false), []);

  useEffect(() => {
    api<Me>("/auth/me").then(setMe, (err) => {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setError("Could not load your account. Check the connection and reload.");
    });
    api<VersionInfo>("/version").then(setVersion, () => undefined);
  }, [router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  // V3.1: whether warehousing is on (re-read on navigation, so creating the first warehouse shows Shifts).
  const [warehousing, setWarehousing] = useState(false);
  useEffect(() => {
    if (!me) return;
    const read = () => api<{ enabled: boolean }>("/warehouses").then((w) => setWarehousing(w.enabled), () => undefined);
    void read();
    // The Warehouses page announces changes (the first warehouse switches warehousing on).
    window.addEventListener("rs:warehouses-changed", read);
    return () => window.removeEventListener("rs:warehouses-changed", read);
  }, [me, pathname]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    // The next person on this browser must never see this user's cached screens.
    queryClient.clear();
    router.replace("/login");
  }

  if (error) return <main className="p-6 text-sm text-rose-600">{error}</main>;
  if (!me) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500">Loading…</div>;

  // Lengths show in metres on purchase / supplier screens, in feet elsewhere (lib/lengthView).
  const lengthScope = /^\/(purchases|suppliers|supplier-prices)(\/|$)/.test(pathname) ? "purchase" : "stock";
  // Checkout belongs to "New Sale/Purchase"; a document page (/sales/<id>) to its history.
  // Otherwise the most specific prefix wins, so /products/categories does not light up Products.
  const path = pathname.replace(/\/checkout$/, "/new");
  const matches = (it: NavItem) =>
    it.exact ? path === it.href || new RegExp(`^${it.href}/c[a-z0-9]{20,}$`).test(path) : path === it.href || path.startsWith(it.href + "/");
  const activeHref = NAV.flatMap((g) => g.items)
    .filter(matches)
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const sections = NAV.map((g) => ({ ...g, items: g.items.filter((it) => (!it.permission || me.permissions.includes(it.permission)) && (!it.warehousing || warehousing)) })).filter((g) => g.items.length);

  return (
    <QueryClientProvider client={queryClient}>
    <MeContext.Provider value={me}>
      <CartProvider>
      <LengthScopeProvider scope={lengthScope}>
        <div className="min-h-screen lg:flex">
          {/* Reserves the collapsed sidebar width on large screens; the sidebar is fixed and widens over the page. */}
          <div className="no-print hidden w-16 shrink-0 lg:block" aria-hidden />
          <aside
            className={`group/nav no-print fixed bottom-0 left-0 top-0 z-40 flex w-60 flex-col overflow-hidden bg-slate-900 text-slate-300 transition-[width,transform,box-shadow] duration-200 ease-out lg:w-16 lg:translate-x-0 lg:hover:w-60 lg:hover:shadow-2xl lg:hover:delay-100 lg:has-[:focus-visible]:w-60 lg:has-[:focus-visible]:shadow-2xl ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}
          >
            <div className="flex items-center justify-between px-3.5 py-3 shrink-0">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white shadow-sm">RS</span>
                <div className="whitespace-nowrap transition-opacity lg:opacity-0 lg:group-hover/nav:opacity-100 lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:opacity-100">
                  <div className="text-sm font-bold tracking-wide text-white">RS MACHINERY</div>
                  <div className="text-[11px] text-slate-400">Inventory</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
                aria-label="Close menu"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <nav aria-label="Main" className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 space-y-2">
              {sections.map((g, i) => (
                <div key={g.section} className={i ? "mt-1.5" : "mt-0.5"}>
                  <div className="relative py-1 flex items-center justify-start lg:justify-center lg:group-hover/nav:justify-start lg:group-has-[:focus-visible]/nav:justify-start px-2">
                    <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-slate-500 inline lg:hidden lg:group-hover/nav:inline lg:group-has-[:focus-visible]/nav:inline px-1">
                      {g.section}
                    </span>
                    <span className="w-6 border-t border-slate-800 hidden lg:block lg:group-hover/nav:hidden lg:group-has-[:focus-visible]/nav:hidden" />
                  </div>
                  {g.items.map((it) => {
                    const active = it.href === activeHref;
                    return (
                      <div key={it.href} className="relative group/item flex items-center justify-start lg:justify-center my-0.5">
                        <Link
                          href={it.href}
                          title={it.label}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center gap-3 w-full h-9 rounded-xl text-sm transition-all ${
                            active
                              ? "bg-brand-600 font-medium text-white shadow-sm shadow-brand-950/40"
                              : "text-slate-400 hover:bg-slate-800/80 hover:text-white"
                          } px-2.5 lg:px-0 justify-start lg:justify-center lg:group-hover/nav:justify-start lg:group-hover/nav:px-2.5 lg:group-has-[:focus-visible]/nav:justify-start lg:group-has-[:focus-visible]/nav:px-2.5`}
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${active ? "text-white" : "text-slate-400 group-hover/item:text-slate-200"}`}>{it.icon}</span>
                          <span className="whitespace-nowrap transition-opacity inline-block lg:hidden lg:group-hover/nav:inline-block lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:inline-block">{it.label}</span>
                        </Link>
                        {/* Instant Tooltip in collapsed desktop mode */}
                        <div className="pointer-events-none absolute left-14 z-50 hidden rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white shadow-xl border border-slate-700 whitespace-nowrap lg:group-hover/item:block lg:group-hover/nav:hidden">
                          {it.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </nav>
            {/* Display preferences & account / logout / switch company */}
            <div className="border-t border-slate-800/80 px-2 py-2 shrink-0 space-y-1">
              <div className="relative group/item flex items-center justify-start lg:justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDisplayOpen((o) => !o);
                  }}
                  title="Display"
                  aria-expanded={displayOpen}
                  className={`flex items-center gap-3 w-full h-9 rounded-xl text-sm transition-all ${
                    displayOpen ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/80 hover:text-white"
                  } px-2.5 lg:px-0 justify-start lg:justify-center lg:group-hover/nav:justify-start lg:group-hover/nav:px-2.5 lg:group-has-[:focus-visible]/nav:justify-start lg:group-has-[:focus-visible]/nav:px-2.5`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${displayOpen ? "text-white" : "text-slate-400 group-hover/item:text-slate-200"}`}><SlidersIcon className={ic} /></span>
                  <span className="whitespace-nowrap transition-opacity inline-block lg:hidden lg:group-hover/nav:inline-block lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:inline-block">Display</span>
                </button>
                <div className="pointer-events-none absolute left-14 z-50 hidden rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white shadow-xl border border-slate-700 whitespace-nowrap lg:group-hover/item:block lg:group-hover/nav:hidden">
                  Display
                </div>
              </div>

              {/* Switch Demo/Real company (if switchUrl provided) */}
              {version?.switchUrl && (
                <div className="relative group/item flex items-center justify-start lg:justify-center">
                  <a
                    href={version.switchUrl}
                    title={version.environment === "CLIENT_READY" ? "Switch to Demo company" : "Switch to Real company"}
                    className="flex items-center gap-3 w-full h-9 rounded-xl text-sm transition-all text-amber-400 hover:bg-slate-800/80 hover:text-amber-300 px-2.5 lg:px-0 justify-start lg:justify-center lg:group-hover/nav:justify-start lg:group-hover/nav:px-2.5 lg:group-has-[:focus-visible]/nav:justify-start lg:group-has-[:focus-visible]/nav:px-2.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center text-amber-400">
                      <ShiftIcon className={ic} />
                    </span>
                    <span className="whitespace-nowrap transition-opacity inline-block lg:hidden lg:group-hover/nav:inline-block lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:inline-block text-xs font-medium">
                      {version.environment === "CLIENT_READY" ? "Switch to Demo" : "Switch to Real"}
                    </span>
                  </a>
                  <div className="pointer-events-none absolute left-14 z-50 hidden rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white shadow-xl border border-slate-700 whitespace-nowrap lg:group-hover/item:block lg:group-hover/nav:hidden">
                    {version.environment === "CLIENT_READY" ? "Switch to Demo company" : "Switch to Real company"}
                  </div>
                </div>
              )}

              {/* User profile (who is logged in) */}
              <div className="relative group/item flex items-center justify-start lg:justify-center pt-1 border-t border-slate-800/60">
                <div
                  className="flex items-center gap-3 w-full h-9 rounded-xl text-sm px-2.5 lg:px-0 justify-start lg:justify-center lg:group-hover/nav:justify-start lg:group-hover/nav:px-2.5 lg:group-has-[:focus-visible]/nav:justify-start lg:group-has-[:focus-visible]/nav:px-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600/30 text-xs font-bold text-brand-300">
                    {me.user.name[0]?.toUpperCase() ?? "U"}
                  </span>
                  <div className="min-w-0 flex-1 whitespace-nowrap transition-opacity inline-block lg:hidden lg:group-hover/nav:inline-block lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:inline-block">
                    <div className="truncate text-xs font-medium text-slate-200">{me.user.name}</div>
                    <div className="text-[10px] uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                      <span>{me.user.role.replace("_", " ")}</span>
                      {version?.environment === "DEMO" && (
                        <span className="rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-400 border border-amber-500/30">DEMO</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="pointer-events-none absolute left-14 z-50 hidden rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white shadow-xl border border-slate-700 whitespace-nowrap lg:group-hover/item:block lg:group-hover/nav:hidden">
                  {me.user.name} ({me.user.role.replace("_", " ")})
                </div>
              </div>

              {/* Logout button */}
              <div className="relative group/item flex items-center justify-start lg:justify-center">
                <button
                  type="button"
                  onClick={logout}
                  title="Logout"
                  className="flex items-center gap-3 w-full h-9 rounded-xl text-sm transition-all text-slate-400 hover:bg-rose-950/40 hover:text-rose-300 px-2.5 lg:px-0 justify-start lg:justify-center lg:group-hover/nav:justify-start lg:group-hover/nav:px-2.5 lg:group-has-[:focus-visible]/nav:justify-start lg:group-has-[:focus-visible]/nav:px-2.5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                    <LogOutIcon className={ic} />
                  </span>
                  <span className="whitespace-nowrap transition-opacity inline-block lg:hidden lg:group-hover/nav:inline-block lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:inline-block text-xs font-medium">
                    Logout
                  </span>
                </button>
                <div className="pointer-events-none absolute left-14 z-50 hidden rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white shadow-xl border border-slate-700 whitespace-nowrap lg:group-hover/item:block lg:group-hover/nav:hidden">
                  Logout
                </div>
              </div>
            </div>
          </aside>
          {displayOpen && <DisplayPanel onClose={closeDisplay} />}
          {menuOpen && <div className="no-print fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} />}

          <div className="min-w-0 flex-1">
            <main className="w-full px-4 pb-24 pt-4 sm:px-6">{children}</main>
          </div>
        </div>
        {!pathname.endsWith("/checkout") && <CartPill />}
        <TableStackLabels />
        <BottomNav pathname={pathname} menuOpen={menuOpen} onMenu={() => setMenuOpen((o) => !o)} />
      </LengthScopeProvider>
      </CartProvider>
    </MeContext.Provider>
    </QueryClientProvider>
  );
}