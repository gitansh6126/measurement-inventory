"use client";

import type { ReactNode } from "react";
import { useCan } from "@/components/MeContext";
import { EmptyState } from "@/components/ui";

/** Shows a plain message instead of a screen the user's role cannot use. The API enforces the same rule. */
export function Restricted({ permission, children }: { permission: string; children: ReactNode }) {
  const allowed = useCan(permission);
  if (!allowed) {
    return (
      <div className="card">
        <EmptyState title="Not available for your role">This section is available to managers and admins.</EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}
