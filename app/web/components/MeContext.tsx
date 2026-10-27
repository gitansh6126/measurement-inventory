"use client";

import { createContext, useContext } from "react";
import type { Me } from "@/lib/api";

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

/** True when the signed-in user holds the permission (UI hint only; the API enforces it). */
export function useCan(permission: string): boolean {
  return useContext(MeContext)?.permissions.includes(permission) ?? false;
}
