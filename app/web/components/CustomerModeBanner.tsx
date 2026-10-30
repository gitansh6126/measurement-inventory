"use client";

import { useCustomerMode } from "@/components/CustomerModeContext";

export function CustomerModeBanner() {
  const { isCustomerMode, openExitModal } = useCustomerMode();

  if (!isCustomerMode) return null;

  return (
    <div className="no-print sticky top-0 z-50 flex items-center justify-between border-b border-amber-400 bg-amber-500 px-4 py-2 text-white shadow-md">
      <div className="flex items-center gap-2 text-xs sm:text-sm">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 font-bold shadow-xs shrink-0">
          🛡️
        </span>
        <div className="leading-tight">
          <span className="font-bold">Customer Mode Active</span>
          <span className="hidden sm:inline text-amber-100 ml-1.5">· Sensitive pricing, histories, and editing are locked.</span>
        </div>
      </div>
      <button
        type="button"
        onClick={openExitModal}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-800 active:scale-95 transition shrink-0 cursor-pointer"
      >
        Exit Customer Mode
      </button>
    </div>
  );
}
