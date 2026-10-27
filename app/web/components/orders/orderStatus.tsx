// Shared labels and colours for sale / purchase orders (docs/orders/ORDER-LIFECYCLE-PLAN.md §2).

export type OrderKind = "SALE" | "PURCHASE";
export type OrderStatus = "DRAFT" | "PLACED" | "ON_DELIVERY" | "PARTIALLY_FULFILLED" | "COMPLETED" | "CANCELLED";

export const ORDER_STATUS: Record<OrderStatus, { label: string; pill: string; dot: string }> = {
  DRAFT: { label: "Draft", pill: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  PLACED: { label: "Placed", pill: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  ON_DELIVERY: { label: "On delivery", pill: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  PARTIALLY_FULFILLED: { label: "Partially fulfilled", pill: "bg-indigo-100 text-indigo-800", dot: "bg-indigo-500" },
  COMPLETED: { label: "Completed", pill: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  CANCELLED: { label: "Cancelled", pill: "bg-rose-100 text-rose-700", dot: "bg-rose-400" },
};

/** The usual next step from each open status (the list's one-click button). */
export const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  DRAFT: { to: "PLACED", label: "Place" },
  PLACED: { to: "ON_DELIVERY", label: "Dispatch" },
  ON_DELIVERY: { to: "COMPLETED", label: "Complete" },
  PARTIALLY_FULFILLED: { to: "COMPLETED", label: "Deliver rest" },
};

export const STEPS: OrderStatus[] = ["DRAFT", "PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED", "COMPLETED"];

export function StatusPill({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${s.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />{s.label}</span>;
}

export const orderDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
