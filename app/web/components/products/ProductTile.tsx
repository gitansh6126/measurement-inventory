"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ProductThumb } from "@/components/ProductThumb";
import type { ProductType } from "@/lib/types";

/**
 * One product card for the Grid view of Products, a category and Stock In: image, name,
 * a meta line with a stock badge, an optional price, and slots for extras.
 * The card itself is not clipped, so a dropdown in `actions` can overflow it.
 */
export function ProductTile({
  id,
  name,
  image,
  href,
  onClick,
  inactive = false,
  highlight = false,
  meta,
  badge,
  price,
  note,
  footer,
  actions,
}: {
  /** Element id, used to scroll a `?focus=` product into view. */
  id: string;
  name: string;
  image: string | null;
  /** Open a page (Link), or run `onClick` (button). */
  href?: string;
  onClick?: () => void;
  inactive?: boolean;
  highlight?: boolean;
  meta?: ReactNode;
  badge?: ReactNode;
  price?: ReactNode;
  /** Extra line inside the clickable area, under the price. */
  note?: ReactNode;
  /** Below the clickable area. */
  footer?: ReactNode;
  /** Top-right buttons over the image. */
  actions?: ReactNode;
}) {
  const body = (
    <>
      <div className="overflow-hidden rounded-t-lg bg-slate-100">
        <ProductThumb src={image} name={name} className="aspect-[4/3] w-full text-xl transition-transform duration-300 group-hover:scale-105" />
      </div>
      <div className="grid flex-1 content-start gap-1 p-3">
        <div className="line-clamp-2 font-semibold text-slate-900">{name}</div>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">{meta}</span>
          {badge}
        </div>
        {price && <div className="text-sm font-semibold text-brand-700">{price}</div>}
        {note}
      </div>
    </>
  );
  const inner = "flex flex-1 flex-col rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
  return (
    <div id={id} className={`group card relative flex flex-col transition hover:-translate-y-0.5 hover:shadow-md ${inactive ? "opacity-60" : ""} ${highlight ? "card-highlight-blink" : ""}`}>
      {href ? (
        <Link href={href} className={inner} aria-label={`Open ${name}`}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={inner}>
          {body}
        </button>
      )}
      {footer && <div className="px-3 pb-2">{footer}</div>}
      {actions && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

/** "Measured · 4 variations", "4 variations", or `fallback` for a single product. */
export function ProductKind({ type, count, fallback }: { type: ProductType; count: ReactNode; fallback?: ReactNode }) {
  if (type === "measured") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">Measured</span>
        <span>{count} variations</span>
      </span>
    );
  }
  if (type === "variable") return <>{count} variations</>;
  return <>{fallback}</>;
}
