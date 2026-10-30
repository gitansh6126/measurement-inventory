"use client";

import { useState } from "react";
import { useCustomerMode } from "@/components/CustomerModeContext";
import { Modal } from "@/components/ui";
import { EyeIcon } from "@/components/icons";

export function CustomerModeExitModal() {
  const { exitModalOpen, closeExitModal, disableCustomerMode } = useCustomerMode();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!exitModalOpen) return null;

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!password.trim()) {
      setError("Please enter your staff password");
      return;
    }
    setError("");
    setLoading(true);
    const res = await disableCustomerMode(password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Incorrect password. Please try again.");
    } else {
      setPassword("");
    }
  }

  function handleClose() {
    setPassword("");
    setError("");
    closeExitModal();
  }

  return (
    <Modal
      open
      title="Exit Customer Mode"
      onClose={handleClose}
    >
      <form onSubmit={handleSubmit} className="grid gap-4 py-1">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <span className="text-base leading-none">🔒</span>
          <div>
            <div className="font-semibold text-amber-900">Protected Staff Access</div>
            <div className="mt-0.5">
              Enter staff password (salesman, manager, or admin) to unlock pricing, stock histories, and sales editing.
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-1.5">
          <label htmlFor="customer-mode-pwd" className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Staff Password
          </label>
          <div className="relative flex items-center">
            <input autoComplete="off"
              id="customer-mode-pwd"
              type={showPassword ? "text" : "password"}
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              placeholder="Enter your password…"
              className="input pr-10 text-sm font-medium w-full"
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2.5 text-slate-400 hover:text-slate-600 focus:outline-none"
              title={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              <EyeIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={handleClose}
            className="btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? "Verifying…" : "Unlock Staff Mode"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
