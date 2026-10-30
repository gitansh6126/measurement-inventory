"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/useApi";

const STORAGE_KEY = "rs_customer_mode";

interface CustomerModeContextValue {
  isCustomerMode: boolean;
  enableCustomerMode: () => Promise<void>;
  disableCustomerMode: (password: string) => Promise<{ ok: boolean; error?: string }>;
  exitModalOpen: boolean;
  openExitModal: () => void;
  closeExitModal: () => void;
}

const CustomerModeContext = createContext<CustomerModeContextValue | null>(null);

export function CustomerModeProvider({ children }: { children: ReactNode }) {
  const [isCustomerMode, setIsCustomerMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [exitModalOpen, setExitModalOpen] = useState(false);

  // Sync state if changed in another window/tab
  useEffect(() => {
    const check = () => {
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY) === "1";
        setIsCustomerMode(stored);
      } catch {
        // ignore
      }
    };
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, []);

  const enableCustomerMode = useCallback(async () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    try {
      await api("/auth/customer-mode/enter", { method: "POST" });
    } catch {
      // continue even if offline
    }
    queryClient.clear();
    setIsCustomerMode(true);
  }, []);

  const disableCustomerMode = useCallback(async (password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await api<{ ok: boolean }>("/auth/customer-mode/exit", {
        method: "POST",
        body: { password },
      });
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      queryClient.clear();
      setIsCustomerMode(false);
      setExitModalOpen(false);
      return { ok: true };
    } catch (err: any) {
      const msg = err?.message || (err?.body && typeof err.body === "object" && err.body.message) || "Incorrect password";
      return { ok: false, error: msg };
    }
  }, []);

  const openExitModal = useCallback(() => setExitModalOpen(true), []);
  const closeExitModal = useCallback(() => setExitModalOpen(false), []);

  return (
    <CustomerModeContext.Provider
      value={{
        isCustomerMode,
        enableCustomerMode,
        disableCustomerMode,
        exitModalOpen,
        openExitModal,
        closeExitModal,
      }}
    >
      {children}
    </CustomerModeContext.Provider>
  );
}

export function useCustomerMode() {
  const ctx = useContext(CustomerModeContext);
  if (!ctx) {
    throw new Error("useCustomerMode must be used within a CustomerModeProvider");
  }
  return ctx;
}
