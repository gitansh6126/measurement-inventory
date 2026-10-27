"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CartProvider } from "@/components/CartContext";
import { CartPill } from "@/components/CartPill";
import { ArrowInIcon, BookIcon, BoxesIcon, CartIcon, DatabaseIcon, InvoiceIcon, LayersIcon, OrderIcon, PackageIcon, ShiftIcon, TruckIcon, UsersIcon, WarehouseIcon } from "@/components/icons";
import { MeContext } from "@/components/MeContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { ApiError, api, type Me } from "@/lib/api";
import { queryClient } from "@/lib/useApi";

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
      { href: "/purchases/orders", label: "Purchase Orders", icon: <OrderIcon className={ic} />, permission: "purchase.view" },
      { href: "/purchases", label: "Purchase History", icon: <BookIcon className={ic} />, permission: "purchase.view", exact: true },
      { href: "/supplier-prices", label: "Supplier Prices", icon: <TruckIcon className={ic} />, permission: "vendor_pricing.view" },
    ],
  },
  {
    section: "Customers",
    items: [
      { href: "/customers", label: "Customers", icon: <InvoiceIcon className={ic} />, permission: "sale.view" },
    ],
  },
  {
    section: "Suppliers",
    items: [
      { href: "/suppliers", label: "Suppliers", icon: <BookIcon className={ic} />, permission: "purchase.view" },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/users", label: "Users", icon: <UsersIcon className={ic} />, permission: "user.manage" },
      { href: "/backup", label: "Backup & Restore", icon: <DatabaseIcon className={ic} />, permission: "user.manage" },
      { href: "/settings", label: "Settings", icon: <DatabaseIcon className={ic} />, permission: "company.settings" },
    ],
  },
  {
    section: "Help",
    items: [{ href: "/glossary", label: "Glossary", icon: <BookIcon className={ic} /> }],
  },
  {
    section: "Stock Tools",
    items: [
      { href: "/import", label: "Import", icon: <ArrowInIcon className={ic} />, permission: "catalog.view" },
      { href: "/shifts", label: "Shifts", icon: <ShiftIcon className={ic} />, permission: "catalog.view", warehousing: true },
      { href: "/warehouses", label: "Warehouses", icon: <WarehouseIcon className={ic} />, permission: "warehouse.manage" },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api<Me>("/auth/me").then(setMe, (err) => {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setError("Could not load your account. Check the connection and reload.");
    });
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
        <div className="min-h-[calc(100vh-28px)] lg:flex">
          {/* Reserves the collapsed sidebar width on large screens; the sidebar is fixed and widens over the page. */}
          <div className="no-print hidden w-16 shrink-0 lg:block" aria-hidden />
          <aside
            className={`group/nav no-print fixed bottom-0 left-0 top-7 z-40 flex w-60 flex-col overflow-hidden bg-slate-900 text-slate-300 transition-[width,transform,box-shadow] duration-200 ease-out lg:w-16 lg:translate-x-0 lg:hover:w-60 lg:hover:shadow-2xl lg:hover:delay-100 lg:has-[:focus-visible]:w-60 lg:has-[:focus-visible]:shadow-2xl ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}
          >
            <div className="flex items-center gap-2.5 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">RS</span>
              <div className="whitespace-nowrap transition-opacity lg:opacity-0 lg:group-hover/nav:opacity-100 lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:opacity-100">
                <div className="text-sm font-bold tracking-wide text-white">RS MACHINERY</div>
                <div className="text-[11px] text-slate-400">Inventory</div>
              </div>
            </div>
            <nav aria-label="Main" className="scroll-dark flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
              {sections.map((g, i) => (
                <div key={g.section} className={i ? "mt-2" : "mt-1"}>
                  <div className="relative h-5 px-3">
                    <span className="whitespace-nowrap text-[10px] font-semibold uppercase leading-5 tracking-wider text-slate-500 transition-opacity lg:opacity-0 lg:group-hover/nav:opacity-100 lg:group-has-[:focus-visible]/nav:opacity-100">
                      {g.section}
                    </span>
                    <span className="absolute inset-x-3 top-1/2 hidden border-t border-slate-700 transition-opacity lg:block lg:group-hover/nav:opacity-0 lg:group-has-[:focus-visible]/nav:opacity-0" />
                  </div>
                  {g.items.map((it) => {
                    const active = it.href === activeHref;
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        title={it.label}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-md px-3 py-[7px] text-sm transition-colors lg:px-[15px] ${active ? "bg-brand-600 font-medium text-white" : "hover:bg-slate-800 hover:text-white"}`}
                      >
                        <span className={`shrink-0 ${active ? "text-white" : "text-slate-500"}`}>{it.icon}</span>
                        <span className="whitespace-nowrap transition-opacity lg:opacity-0 lg:group-hover/nav:opacity-100 lg:group-hover/nav:delay-100 lg:group-has-[:focus-visible]/nav:opacity-100">{it.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>
          {menuOpen && <div className="no-print fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} />}

          <div className="min-w-0 flex-1">
            <header className="no-print sticky top-7 z-30 flex h-9 items-center justify-between border-b border-slate-200 bg-white/90 px-4 text-xs backdrop-blur">
              <button className="-ml-1 rounded p-1 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="hidden text-slate-500 lg:block">
                {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">{me.user.name[0]?.toUpperCase()}</span>
                <span className="font-medium text-slate-800">{me.user.name}</span>
                <span className="uppercase text-slate-400">{me.user.role.replace("_", " ")}</span>
                <span className="text-slate-300">|</span>
                <button onClick={logout} className="font-medium text-slate-600 hover:text-brand-600">Logout</button>
              </div>
            </header>
            <main className="mx-auto max-w-7xl px-4 pb-24 pt-4 sm:px-6">{children}</main>
          </div>
        </div>
        {!pathname.endsWith("/checkout") && <CartPill />}
      </CartProvider>
    </MeContext.Provider>
    </QueryClientProvider>
  );
}