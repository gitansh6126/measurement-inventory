"use client";

import { useEffect } from "react";
import { installEnterNavigation } from "@/lib/enterNav";

/** Enter moves to the next field on every screen (see lib/enterNav.ts). */
export function EnterKeyNavigation() {
  useEffect(() => installEnterNavigation(), []);
  return null;
}
