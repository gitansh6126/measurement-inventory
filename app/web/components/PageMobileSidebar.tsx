"use client";

import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "@/components/icons";

export interface PageMobileSidebarProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * In-page mobile sidebar / drawer for pages whose desktop headers are too busy for phones.
 * Houses filters, view mode toggles, page actions, and metrics cleanly off-canvas.
 */
export function PageMobileSidebar({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
}: PageMobileSidebarProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock background scrolling while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
        aria-label="Close options sidebar"
      />

      {/* Slide-over panel */}
      <div className="relative z-10 flex h-full w-full max-w-[88vw] sm:max-w-md flex-col bg-white shadow-2xl border-l border-slate-200 animate-drawer-in-right">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 bg-slate-50/70">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 truncate">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="text-xs text-slate-500 truncate mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 active:scale-95 transition-all cursor-pointer"
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {children}
        </div>

        {/* Sticky footer */}
        {footer && (
          <div className="border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function SidebarSection({
  title,
  badge,
  action,
  children,
  className = "",
}: {
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5 ${className}`}>
      {title && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {title}
            </span>
            {badge}
          </div>
          {action}
        </div>
      )}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function SidebarField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs font-semibold text-slate-700">{label}</label>
      </div>
      {description && <p className="mb-1.5 text-[11px] text-slate-400">{description}</p>}
      {children}
    </div>
  );
}
