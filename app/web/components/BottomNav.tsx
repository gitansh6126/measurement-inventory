"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCart } from "@/components/CartContext";
import { CartIcon, HomeIcon, OrderIcon, PackageIcon } from "@/components/icons";
import { useMe } from "@/components/MeContext";
import { useCustomerMode } from "@/components/CustomerModeContext";

// Phone/tablet tab bar (RMS Tech reference, 2026-10-27): the most used places one tap away
// instead of behind the menu. Below lg only; the desktop sidebar is unchanged.
type Tab = { href: string; label: string; icon: ReactNode; permission?: string; active: (path: string) => boolean };
const ic = "h-5 w-5";

export function BottomNav({ pathname, onMenu, menuOpen }: { pathname: string; onMenu: () => void; menuOpen: boolean }) {
  const me = useMe();
  const cart = useCart();
  const { isCustomerMode, openExitModal } = useCustomerMode();
  const cartMode = cart.count && cart.mode ? cart.mode : "sale";
  const cartHref = cartMode === "sale" ? "/sales/checkout" : "/purchases/checkout";
  // Same "short" rule as the cart pill: sale lines asking for more than is in stock.
  const short = cart.mode === "sale" ? cart.lines.filter((l) => l.quantity > l.available).length : 0;

  const item = (on: boolean) =>
    `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
      on ? "bg-brand-50 text-brand-700" : "text-slate-500 active:bg-slate-100"
    }`;

  if (isCustomerMode) {
    return (
      <nav
        aria-label="Customer navigation"
        className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-amber-300 bg-white/95 px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch gap-1">
          <Link href="/products" aria-current={pathname.startsWith("/products") ? "page" : undefined} className={item(pathname.startsWith("/products"))}>
            <PackageIcon className={ic} />
            <span className="truncate">Products</span>
          </Link>
          <Link href="/sales/new" aria-current={pathname === "/sales/new" ? "page" : undefined} className={item(pathname === "/sales/new")}>
            <svg className={ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            <span className="truncate">New Sale</span>
          </Link>
          <button
            type="button"
            onClick={() => cart.openDrawer()}
            className={item(false)}
          >
            <span className="relative">
              <CartIcon className={ic} />
              {cart.count > 0 && (
                <span className="absolute -right-2.5 -top-1.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white bg-brand-600">
                  {cart.count}
                </span>
              )}
            </span>
            <span className="truncate">Cart</span>
          </button>
          <button
            type="button"
            onClick={openExitModal}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold text-amber-700 active:bg-amber-50"
          >
            <span className="text-base leading-none">🔓</span>
            <span className="truncate">Exit Mode</span>
          </button>
        </div>
      </nav>
    );
  }

  const tabs: Tab[] = [
    { href: "/", label: "Home", icon: <HomeIcon className={ic} />, active: (p) => p === "/" },
    { href: "/products", label: "Products", icon: <PackageIcon className={ic} />, permission: "catalog.view", active: (p) => p.startsWith("/products") },
    {
      href: "/sales/new",
      label: "New Sale",
      icon: (
        <svg className={ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      ),
      permission: "sale.create",
      active: (p) => p === "/sales/new",
    },
    {
      href: cartHref,
      label: "Cart",
      icon: (
        <span className="relative">
          <CartIcon className={ic} />
          {cart.count > 0 && (
            <span className={`absolute -right-2.5 -top-1.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white ${short ? "bg-amber-500" : "bg-rose-600"}`}>
              {cart.count}
            </span>
          )}
        </span>
      ),
      permission: cartMode === "sale" ? "sale.create" : "purchase.create",
      active: (p) => p.endsWith("/checkout"),
    },
    { href: "/sales/orders", label: "Orders", icon: <OrderIcon className={ic} />, permission: "sale.view", active: (p) => p.startsWith("/sales/orders") },
  ];
  const visible = tabs.filter((t) => !t.permission || me?.permissions.includes(t.permission));

  return (
    <nav
      aria-label="Quick navigation"
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch gap-1">
        {visible.map((t) => {
          const on = !menuOpen && t.active(pathname);
          return (
            <Link key={t.label} href={t.href} aria-current={on ? "page" : undefined} className={item(on)}>
              {t.icon}
              <span className="truncate">{t.label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} className={item(menuOpen)}>
          <svg className={ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}
